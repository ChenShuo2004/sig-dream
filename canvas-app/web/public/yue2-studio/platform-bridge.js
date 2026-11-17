/* Platform bridge: YuE2 UI → canvas-lan queue + file-machine Yue2 proxy */
(function (global) {
  "use strict";

  var QUEUE_PREFIX = "/api-proxy/canvas-lan/yue2/queue";
  var SYNC_PREFIX = "/api-proxy/canvas-lan/yue2/proxy";

  function readToken() {
    try {
      var session = localStorage.getItem("lcp_auth_session");
      if (session) {
        var parsed = JSON.parse(session);
        if (parsed && typeof parsed.access_token === "string" && parsed.access_token) {
          return parsed.access_token;
        }
      }
    } catch (e) {}
    try {
      var legacy = localStorage.getItem("token");
      if (legacy) return legacy;
    } catch (e2) {}
    try {
      var match = document.cookie.match(/(?:^|;\s*)lcp_auth_token=([^;]+)/);
      if (match) return decodeURIComponent(match[1]);
    } catch (e3) {}
    return "";
  }

  function authHeaders(extra) {
    var headers = Object.assign({}, extra || {});
    var token = readToken();
    if (token) headers.Authorization = "Bearer " + token;
    return headers;
  }

  function errorMessage(data, fallback) {
    if (!data) return fallback;
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      try {
        return data.detail
          .map(function (item) {
            if (typeof item === "string") return item;
            if (item && typeof item.msg === "string") return item.msg;
            return JSON.stringify(item);
          })
          .filter(Boolean)
          .join("；") || fallback;
      } catch (e) {
        return fallback;
      }
    }
    if (typeof data.error === "string") return data.error;
    if (typeof data.message === "string") return data.message;
    return fallback;
  }

  function isJobCreate(path, method) {
    return method === "POST" && /^\/api\/jobs\/?$/.test(path);
  }

  function isJobGet(path) {
    return /^\/api\/jobs\/[^/]+\/?$/.test(path);
  }

  function isJobList(path) {
    return /^\/api\/jobs\/?$/.test(path) || path.indexOf("/api/jobs?") === 0;
  }

  function isJobCancel(path, method) {
    return (
      method === "POST" && /^\/api\/jobs\/[^/]+\/cancel\/?$/.test(path)
    ) || (
      method === "DELETE" && /^\/api\/jobs\/[^/]+\/?$/.test(path)
    );
  }

  function jobIdFromPath(path) {
    var m = path.match(/^\/api\/jobs\/([^/?]+)/);
    return m ? m[1] : "";
  }

  function contentUrl(jobId) {
    var url = QUEUE_PREFIX + "/jobs/" + encodeURIComponent(jobId) + "/content";
    var token = readToken();
    if (token) url += (url.indexOf("?") >= 0 ? "&" : "?") + "access_token=" + encodeURIComponent(token);
    return url;
  }

  function ensureAudioUrls(job) {
    if (!job || typeof job !== "object" || !job.id) return job;
    var kind = String(job.kind || "");
    // Transcribe/plan finish with ABC etc. — do not invent a mixdown URL.
    if (
      kind === "transcribe" ||
      kind === "plan" ||
      kind === "doctor" ||
      kind === "midi_extract" ||
      (job.result && job.result.has_audio === false)
    ) {
      return job;
    }
    var audio = contentUrl(job.id);
    var result = job.result && typeof job.result === "object" ? Object.assign({}, job.result) : {};
    if (job.status === "complete" || job.status === "success" || job.status === "succeeded") {
      result.audio = result.audio === "platform-output" || !result.audio ? audio : result.audio;
      if (Array.isArray(result.candidates)) {
        result.candidates = result.candidates.map(function (item) {
          if (!item || typeof item !== "object") return item;
          var next = Object.assign({}, item);
          if (next.audio === "platform-output" || !next.audio) next.audio = audio;
          return next;
        });
      } else {
        result.candidates = [{ index: 1, audio: audio, audio_seconds: result.audio_seconds }];
      }
    }
    return Object.assign({}, job, { result: result });
  }

  async function readJson(res) {
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      var err = new Error(errorMessage(data, "request failed (" + res.status + ")"));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function queueCreate(body, init) {
    var payload = body;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        payload = {};
      }
    }
    // Assistant lyric/style jobs run on platform API channels — never the YuE2 music GPU queue.
    if (payload && payload.kind === "assistant") {
      var assistantRes = await fetch(QUEUE_PREFIX + "/jobs", {
        method: "POST",
        headers: authHeaders(
          Object.assign({ "Content-Type": "application/json" }, (init && init.headers) || {})
        ),
        body: JSON.stringify(payload),
        credentials: "same-origin",
      });
      return await readJson(assistantRes);
    }
    var res = await fetch(QUEUE_PREFIX + "/jobs", {
      method: "POST",
      headers: authHeaders(
        Object.assign({ "Content-Type": "application/json" }, (init && init.headers) || {})
      ),
      body: JSON.stringify(payload || {}),
      credentials: "same-origin",
    });
    return ensureAudioUrls(await readJson(res));
  }

  async function queueGet(id) {
    var res = await fetch(QUEUE_PREFIX + "/jobs/" + encodeURIComponent(id), {
      headers: authHeaders(),
      credentials: "same-origin",
    });
    return ensureAudioUrls(await readJson(res));
  }

  async function queueList(query) {
    var url = QUEUE_PREFIX + "/jobs" + (query ? "?" + query : "");
    var res = await fetch(url, {
      headers: authHeaders(),
      credentials: "same-origin",
    });
    var data = await readJson(res);
    var params = new URLSearchParams(query || "");
    var statusFilter = (params.get("status") || "").toLowerCase();
    var kindFilter = params.get("kind") || "";
    var jobs;
    if (Array.isArray(data)) {
      jobs = data.map(ensureAudioUrls);
    } else {
      jobs = (data.jobs || data.items || []).map(ensureAudioUrls);
    }
    // Client-side safety net if an older API build ignored filters (empty「已完成」list).
    if (statusFilter) {
      var aliases = {
        complete: ["complete", "success", "succeeded"],
        success: ["complete", "success", "succeeded"],
        queued: ["queued", "pending"],
        pending: ["queued", "pending"],
      };
      var wanted = aliases[statusFilter] || [statusFilter];
      jobs = jobs.filter(function (job) {
        return wanted.indexOf(String((job && job.status) || "").toLowerCase()) >= 0;
      });
    }
    if (kindFilter) {
      jobs = jobs.filter(function (job) {
        return String((job && job.kind) || "") === kindFilter;
      });
    }
    var total = Array.isArray(data) ? jobs.length : data.total != null ? data.total : jobs.length;
    if (statusFilter || kindFilter) total = jobs.length;
    return { jobs: jobs, total: total };
  }

  async function queueCancel(id) {
    var res = await fetch(QUEUE_PREFIX + "/jobs/" + encodeURIComponent(id) + "/cancel", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ force: true }),
      credentials: "same-origin",
    });
    return ensureAudioUrls(await readJson(res));
  }

  function syntheticHealth() {
    return {
      ready: {
        ok: true,
        settings_error: null,
        // Keep UI gates unlocked in platform-queue mode; actual GPU work still goes through lan_yue2.
        capabilities: {
          generation: true,
          transcription: true,
          voice: true,
          voice_conversion: true,
          score_renderer: true,
          mulacover: true,
        },
        mulacover_models: {
          ready: true,
          components: {
            transcription: { ready: true },
            style: { ready: true },
            generation: { ready: true },
            decode: { ready: true },
          },
        },
      },
      current_job: null,
      queued: 0,
      accelerator: "platform-queue",
      gpu: "YuE2 via file-machine lan_yue2",
    };
  }

  function shouldStubLocalOnly(path) {
    return (
      path.indexOf("/api/health") === 0 ||
      path.indexOf("/api/memory") === 0 ||
      path.indexOf("/api/update") === 0 ||
      path.indexOf("/api/retention") === 0 ||
      path.indexOf("/api/settings") === 0 ||
      path.indexOf("/api/open-directory") === 0 ||
      // RVC/workbench probes are optional on the song page; proxying them to a
      // dead LAN file-machine used to wedge the whole API worker.
      path.indexOf("/api/rvc") === 0 ||
      path.indexOf("/api/workbench") === 0
    );
  }

  function isAbortError(error) {
    if (!error) return false;
    if (error.name === "AbortError") return true;
    return /signal is aborted|aborted without reason|The operation was aborted/i.test(String(error.message || error));
  }

  function uploadTimeoutMs(byteLength) {
    // Keep in sync with backend _yue2_proxy_timeout ladder (+30s browser slack).
    var size = Math.max(0, Number(byteLength) || 0);
    var mb = 1024 * 1024;
    if (size <= 1 * mb) return 90 * 1000;
    if (size <= 5 * mb) return 150 * 1000;
    if (size <= 20 * mb) return 330 * 1000;
    if (size <= 50 * mb) return 630 * 1000;
    return 930 * 1000;
  }

  async function syncProxy(path, init) {
    var method = ((init && init.method) || "GET").toUpperCase();
    var url = SYNC_PREFIX + path;
    var headers = authHeaders((init && init.headers) || {});
    // YuE2 proxy via file-machine can exceed 20s when 8190 is busy; a short abort
    // surfaced as「任务失败 · signal is aborted without reason」even after the song finished.
    // Remix/cover audio uploads use a size ladder (WAN → file-machine → 88).
    var body = init && init.body;
    var bodyBytes = 0;
    if (typeof Blob !== "undefined" && body instanceof Blob) bodyBytes = body.size;
    else if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) bodyBytes = body.byteLength;
    else if (body && typeof body.byteLength === "number") bodyBytes = body.byteLength;
    else if (typeof body === "string") bodyBytes = body.length;
    var isUpload = path.indexOf("/api/uploads") === 0 || bodyBytes > 256 * 1024;
    var timeoutMs = isUpload ? uploadTimeoutMs(bodyBytes) : 120000;
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = setTimeout(function () {
        try {
          if (typeof controller.abort === "function") {
            try {
              controller.abort("yue2-proxy-timeout");
            } catch (e1) {
              controller.abort();
            }
          }
        } catch (e) {}
      }, timeoutMs);
    }
    var opts = {
      method: method,
      headers: headers,
      credentials: "same-origin",
      signal: controller ? controller.signal : undefined,
    };
    if (init && init.body != null && method !== "GET" && method !== "HEAD") {
      opts.body = init.body;
    }
    try {
      var res = await fetch(url, opts);
      var ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.indexOf("application/json") >= 0 || ct.indexOf("text/") >= 0 || !ct) {
        return readJson(res);
      }
      if (!res.ok) {
        var text = await res.text().catch(function () {
          return "";
        });
        var err = new Error(text || "proxy failed");
        err.status = res.status;
        throw err;
      }
      return res;
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error("请求超时或已取消。歌曲若已在任务记录里生成成功，可直接打开试听，无需当作失败。");
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function platformFetchJson(url, init) {
    var res = await fetch(url, {
      method: (init && init.method) || "GET",
      headers: authHeaders((init && init.headers) || {}),
      body: init && init.body != null ? init.body : undefined,
      credentials: "same-origin",
    });
    return readJson(res);
  }

  async function assistantRuntime() {
    return platformFetchJson("/api-proxy/canvas-lan/yue2/assistant-llm/runtime");
  }

  async function assistantSync() {
    return platformFetchJson("/api-proxy/canvas-lan/yue2/assistant-llm/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  }

  async function platformApi(path, init) {
    init = init || {};
    var method = (init.method || "GET").toUpperCase();
    var clean = path.split("?")[0];
    var query = path.indexOf("?") >= 0 ? path.slice(path.indexOf("?") + 1) : "";

    // Creation-assistant LLM uses platform API channels (dropdown), not a second Key form.
    if (clean === "/api/assistant/config") {
      if (method === "GET") return assistantRuntime();
      var synced = await assistantSync();
      return synced;
    }
    if (clean === "/api/assistant/credentials") {
      var credSync = await assistantSync();
      return {
        credential_id: (credSync.config && credSync.config.credential_id) || "platform",
        available: !!(credSync.credential && credSync.credential.available),
        sync: credSync.sync,
      };
    }
    if (clean === "/api/assistant/drafts" && method === "GET") {
      return {};
    }
    if (clean === "/api/assistant/drafts" && method === "POST") {
      return { ok: true };
    }

    // Upload remix/cover audio to ECS staging — do NOT proxy through unreachable file-machine WAN.
    if (clean === "/api/uploads" && method === "POST") {
      var uploadUrl = "/api-proxy/canvas-lan/yue2/uploads" + (query ? "?" + query : "");
      var uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: authHeaders((init && init.headers) || {}),
        body: init.body,
        credentials: "same-origin",
      });
      return await readJson(uploadRes);
    }

    if (isJobCreate(clean, method)) {
      var body = init.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch (e) {
          body = {};
        }
      }
      return queueCreate(body, init);
    }
    if (method === "GET" && isJobList(path)) {
      return queueList(query);
    }
    if (method === "GET" && isJobGet(clean)) {
      return queueGet(jobIdFromPath(clean));
    }
    if (isJobCancel(clean, method)) {
      return queueCancel(jobIdFromPath(clean));
    }

    // Do not pin the single API worker on LAN health/settings probes (can block job submit).
    if (shouldStubLocalOnly(clean)) {
      if (clean === "/api/health") return syntheticHealth();
      if (clean === "/api/settings" && method === "GET") {
        return {
          model_directory: "on-gpu-88",
          ready: syntheticHealth().ready,
          capabilities: syntheticHealth().ready.capabilities,
        };
      }
      if (clean.indexOf("/api/memory") === 0) {
        return { status: "ok", gib: 0, detail: "平台队列模式不查询 88 本机显存" };
      }
      if (clean.indexOf("/api/update") === 0) {
        return { status: "ok", available: false, message: "平台托管副本，不走本机更新" };
      }
      if (clean.indexOf("/api/retention") === 0) {
        return { usage: { jobs: { gib: 0 }, uploads: { gib: 0 }, logs: { gib: 0 } }, deleted: {} };
      }
      if (clean.indexOf("/api/rvc") === 0) {
        return { voices: [], models: [], status: "ok", message: "平台队列模式暂不查询本机 RVC" };
      }
      if (clean.indexOf("/api/workbench") === 0) {
        if (clean.indexOf("/api/workbench/projects") === 0) return [];
        return { status: "ok", projects: [], drafts: [] };
      }
      return { status: "ok" };
    }

    return syncProxy(path, init);
  }

  function platformAudioUrl(pathOrUrl) {
    if (!pathOrUrl) return "";
    var s = String(pathOrUrl);
    if (/^https?:\/\//i.test(s) || s.indexOf("/api-proxy/") === 0 || s.indexOf("/canvas-lan/") === 0) {
      return s;
    }
    if (s.indexOf("/api/files/") === 0 || s.indexOf("/files/") === 0) {
      return SYNC_PREFIX + (s.indexOf("/api/") === 0 ? s : "/api" + s);
    }
    if (s.charAt(0) === "/") return SYNC_PREFIX + s;
    return s;
  }

  global.Yue2PlatformBridge = {
    api: platformApi,
    audioUrl: platformAudioUrl,
    readToken: readToken,
    QUEUE_PREFIX: QUEUE_PREFIX,
    SYNC_PREFIX: SYNC_PREFIX,
  };
})(window);
