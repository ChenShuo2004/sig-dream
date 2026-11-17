const localImports: Record<string, string> = {
    '20261012-091927.png': 'prompts/local-imports/20261012-091927.png',
    '20261020-151420.png': 'prompts/local-imports/20261020-151420.png',
    'c71371b2-ca75-4f0d-b2d0-47126a615187.jpeg': 'prompts/local-imports/c71371b2-ca75-4f0d-b2d0-47126a615187.jpeg',
    'e52e1969-6a26-4dda-a53b-d17b77f8d472.jpeg': 'prompts/local-imports/e52e1969-6a26-4dda-a53b-d17b77f8d472.jpeg',
    '周砚：平凡生活的观察者.png': 'prompts/local-imports/16f48050da82.png',
    '彩铅写实风青年肖像三联图.png': 'prompts/local-imports/513c57ad3746.png',
    '彩铅风格男性三视图角色设定稿.png': 'prompts/local-imports/a0d2e1c3ba35.png',
    '林朔：冷静思考者角色设定板.png': 'prompts/local-imports/c60a28a90d5f.png',
    '男孩三视角彩铅肖像_emitting.png': 'prompts/local-imports/d606108cb22e.png',
    '青年男性服装设计参考表.png': 'prompts/local-imports/8c7aa793406b.png',
    'canvas-image-image-1792468647576-pa21l.png': 'prompts/local-imports/canvas-image-image-1792468647576-pa21l.png',
    'bd60d7e9-ea3f-499a-98f6-725b4aba5f59.mp4': 'prompts/local-imports/bd60d7e9-ea3f-499a-98f6-725b4aba5f59.mp4',
    'e52e1969-6a26-4dda-a53b-d17b77f8d472.jpe': 'prompts/local-imports/e52e1969-6a26-4dda-a53b-d17b77f8d472.jpeg',
    'c71371b2-ca75-4f0d-b2d0-47126a615187.jpe': 'prompts/local-imports/c71371b2-ca75-4f0d-b2d0-47126a615187.jpeg',
};

export function localImportUrl(title?: string) {
    const name = fileNameFromTitle(title);
    const file = name ? localImports[name] : "";
    if (!file || typeof window === "undefined") return "";
    return new URL(encodeURI(file), new URL(import.meta.env.BASE_URL || "/", window.location.href)).href;
}

function fileNameFromTitle(title?: string) {
    const line = (title || "").split(/\r?\n/, 1)[0]?.trim() || "";
    const base = line.split(/[/\\]/).pop() || "";
    return base.replace(/\s+Copy(?:\s+\d+)?$/i, "").trim();
}
