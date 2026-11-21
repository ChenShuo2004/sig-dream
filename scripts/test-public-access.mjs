import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { startServer } from "../server/index.mjs";
import { loadPlaywright, launchChromium } from "./_playwright.mjs";
const password = randomBytes(32).toString("hex");
const server = await startServer({host:"0.0.0.0",port:0,access:{username:"qa",password}});
const browser = await launchChromium(await loadPlaywright());
try {
    const context = await browser.newContext({httpCredentials:{username:"qa",password}});
    const page=await context.newPage();
    await page.goto(server.url);
    await page.getByRole("button",{name:"进入无限画布",exact:true}).waitFor();
    const result=await page.evaluate(async()=>{
        const res=await fetch("/api-proxy/canvas-api/generated-media",{method:"POST",headers:{Authorization:"Bearer provider-test"},body:JSON.stringify({url:"http://169.254.169.254/"})});
        return {status:res.status,cookie:document.cookie,body:await res.text()};
    });
    assert.equal(result.status,502);assert.match(result.body,/blocked/);assert.ok(!result.cookie.includes("sig_dream_access"));
    await mkdir("release/agent-connections",{recursive:true});
    await writeFile("release/agent-connections/public-access-report.json",JSON.stringify({browserLogin:true,httpOnlySession:true,providerHeaderDoesNotBypassOrBreakAccess:true,privateTargetBlocked:true},null,2));
    console.log("PASS: browser access login, HttpOnly session, provider header separation and SSRF denial");
} finally {await browser.close();await server.close();}
