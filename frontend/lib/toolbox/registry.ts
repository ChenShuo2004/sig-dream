export type ToolboxRuntime = "browser" | "ecs" | "nas-worker" | "electron-main";
export type ToolboxDataPath = "local-file" | "material-id";

export type ToolboxToolDef = {
  id: string;
  title: string;
  description: string;
  path: string;
  runnable: { web: boolean; desktop: boolean };
  runtime: ToolboxRuntime;
  dataPath: ToolboxDataPath;
};

export const TOOLBOX_TOOLS: ToolboxToolDef[] = [
  {
    id: "video-to-gif",
    title: "视频片段转 GIF",
    description: "选择本机视频，截取短片段并导出 GIF（不上传、不入库）",
    path: "/toolbox/video-to-gif",
    runnable: { web: true, desktop: true },
    runtime: "browser",
    dataPath: "local-file",
  },
];

export function getToolboxTool(id: string): ToolboxToolDef | undefined {
  return TOOLBOX_TOOLS.find((t) => t.id === id);
}
