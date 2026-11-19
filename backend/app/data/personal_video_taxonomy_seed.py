"""第二素材库默认一二级分类种子（通用视频内容分类），供 Alembic 迁移初始化使用。"""

from __future__ import annotations

# (一级名, 英文码, 二级名列表)
PERSONAL_VIDEO_TAXONOMY_TREE: list[tuple[str, str, list[str]]] = [
    (
        "开场与引入",
        "Opening",
        [
            "强钩子开场",
            "提问引入",
            "痛点切入",
            "故事引入",
            "数据与结论先行",
        ],
    ),
    (
        "核心讲述",
        "Core",
        [
            "观点阐述",
            "案例拆解",
            "步骤演示",
            "对比分析",
            "经验复盘",
        ],
    ),
    (
        "视觉与氛围",
        "Visual",
        [
            "人物出镜",
            "B-roll 空镜",
            "信息图表",
            "字幕强调",
            "转场过渡",
        ],
    ),
    (
        "结尾与互动",
        "Closing",
        [
            "总结金句",
            "行动号召",
            "评论互动",
            "下期预告",
        ],
    ),
]


def iter_personal_video_taxonomy() -> list[tuple[str, str, list[str]]]:
    return list(PERSONAL_VIDEO_TAXONOMY_TREE)
