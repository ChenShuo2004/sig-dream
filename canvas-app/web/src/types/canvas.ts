export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    MediaProcess = "media-process",
    TextProcess = "text-process",
    VoiceDesign = "voice-design",
    SeedVc = "seed-vc",
    Group = "group",
}

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasNodeImage = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    storageKey?: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
};

export type CanvasNodeText = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    composerWidth?: number;
    composerHeight?: number;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    background?: string;
    count?: number;
    textCount?: number;
    texts?: CanvasNodeText[];
    primaryTextId?: string;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    videoMode?: string;
    runningHubInstanceType?: string;
    /** RunningHub Minimax H3 人脸优化的去油腻强度，0 到 1。 */
    h3DeOilStrength?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    /** Media-process node: trim range and the frame playhead, in seconds. */
    mediaTrimStart?: string;
    mediaTrimEnd?: string;
    mediaFrameTime?: string;
    mediaProcessJob?: "trim" | "frame";
    /** 从音频或视频节点拉出的裁剪节点只读取这一种来源。 */
    mediaTrimKind?: "audio" | "video";
    /** MiniMax H3 Chinese/English pair. English is the submit text. h3Original is the prompt before the first conversion. */
    h3Zh?: string;
    h3En?: string;
    h3Lang?: "zh" | "en";
    h3Dirty?: "zh" | "en" | "";
    h3Original?: string;
    textProcessJob?: "h3" | "sync" | "output";
    /** VoiceStudio design node. The generated audio reads voiceDesignText. */
    voiceDesignText?: string;
    voiceDesignDescription?: string;
    voiceDesignGender?: string;
    voiceDesignAge?: string;
    voiceDesignPitch?: string;
    voiceDesignStyle?: string;
    voiceDesignAccent?: string;
    voiceDesignDialect?: string;
    voiceDesignSeed?: string;
    voiceDesignUnmatched?: string;
    voiceDesignJob?: "describe" | "generate";
    /** Seed-VC Gradio page settings. Source keeps its content; reference supplies the timbre. */
    seedVcSourceKey?: string;
    seedVcReferenceKey?: string;
    seedVcSteps?: number;
    seedVcLength?: number;
    seedVcCfg?: number;
    seedVcJob?: "convert";
    videoTaskId?: string;
    /** True while a saved video task is being queried after the page is opened again. Not the same as still generating. */
    videoTaskChecking?: boolean;
    videoTaskProvider?: "openai" | "gemini" | "ai007" | "onion" | "geeknow" | "runninghub" | "apimart" | "metaso" | "volcengine";
    groupId?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
