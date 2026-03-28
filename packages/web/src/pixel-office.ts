interface PixelSprite {
  url: string;
  w: number;
  h: number;
}

const PIXEL_OFFICE_SPRITES_DIR = "/assets/pixel-office/sprites";

export const PIXEL_OFFICE_EVENT_ICON_METHODS = [
  "thread/started",
  "thread/archived",
  "thread/unarchived",
  "thread/closed",
  "thread/status/changed",
  "thread/tokenUsage/updated",
  "turn/started",
  "turn/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "item/commandExecution/requestApproval",
  "item/fileChange/outputDelta",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "item/tool/call",
  "serverRequest/resolved"
] as const;

export const PIXEL_OFFICE_EVENT_ICON_URLS = Object.fromEntries(
  PIXEL_OFFICE_EVENT_ICON_METHODS.map((method) => [method, `${PIXEL_OFFICE_SPRITES_DIR}/icons/${method}.svg`])
) as Record<(typeof PIXEL_OFFICE_EVENT_ICON_METHODS)[number], string>;

export const OFFICIAL_CODEX_THREAD_ITEM_TYPES = [
  "userMessage",
  "agentMessage",
  "plan",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabToolCall",
  "webSearch",
  "imageView",
  "enteredReviewMode",
  "exitedReviewMode",
  "contextCompaction"
] as const;

export const PIXEL_OFFICE_THREAD_ITEM_ICON_URLS = {
  userMessage: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/userMessage.svg`,
  agentMessage: PIXEL_OFFICE_EVENT_ICON_URLS["item/agentMessage/delta"],
  plan: PIXEL_OFFICE_EVENT_ICON_URLS["item/plan/delta"],
  reasoning: PIXEL_OFFICE_EVENT_ICON_URLS["item/reasoning/summaryTextDelta"],
  commandExecution: PIXEL_OFFICE_EVENT_ICON_URLS["item/commandExecution/outputDelta"],
  fileChange: PIXEL_OFFICE_EVENT_ICON_URLS["item/fileChange/outputDelta"],
  mcpToolCall: PIXEL_OFFICE_EVENT_ICON_URLS["item/tool/call"],
  dynamicToolCall: PIXEL_OFFICE_EVENT_ICON_URLS["item/tool/call"],
  collabToolCall: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/collabToolCall.svg`,
  collabAgentToolCall: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/collabToolCall.svg`,
  webSearch: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/webSearch.svg`,
  imageView: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/imageView.svg`,
  enteredReviewMode: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/enteredReviewMode.svg`,
  exitedReviewMode: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/exitedReviewMode.svg`,
  contextCompaction: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/contextCompaction.svg`
} as const;

function pixelOfficeSprite(group: string, name: string, w: number, h: number): PixelSprite {
  return {
    url: `${PIXEL_OFFICE_SPRITES_DIR}/${group}/${name}.png`,
    w,
    h
  };
}

export const PIXEL_OFFICE_MANIFEST = {
  icons: {
    worktree: {
      url: `${PIXEL_OFFICE_SPRITES_DIR}/icons/worktree.svg`,
      w: 16,
      h: 16
    }
  },
  avatars: [
    { id: "nova", ...pixelOfficeSprite("avatars", "nova", 15, 23) },
    { id: "lex", ...pixelOfficeSprite("avatars", "lex", 19, 24) },
    { id: "mira", ...pixelOfficeSprite("avatars", "mira", 13, 21) },
    { id: "atlas", ...pixelOfficeSprite("avatars", "atlas", 17, 23) },
    { id: "echo", ...pixelOfficeSprite("avatars", "echo", 17, 23) }
  ],
  chairs: [
    pixelOfficeSprite("chairs", "chair-1", 11, 22),
    pixelOfficeSprite("chairs", "chair-2", 11, 22),
    pixelOfficeSprite("chairs", "chair-3", 11, 22),
    pixelOfficeSprite("chairs", "chair-4", 11, 22),
    pixelOfficeSprite("chairs", "chair-5", 11, 22),
    pixelOfficeSprite("chairs", "chair-6", 11, 22)
  ],
  props: {
    sky: pixelOfficeSprite("props", "sky", 256, 38),
    floorStrip: pixelOfficeSprite("props", "floorStrip", 73, 24),
    deskWide: pixelOfficeSprite("props", "deskWide", 40, 16),
    deskSmall: pixelOfficeSprite("props", "deskSmall", 26, 16),
    counter: pixelOfficeSprite("props", "deskWide", 40, 16),
    cabinet: pixelOfficeSprite("props", "cabinet", 26, 20),
    cubiclePanelLeft: pixelOfficeSprite("props", "cubiclePanelLeft", 17, 19),
    cubiclePanelRight: pixelOfficeSprite("props", "cubiclePanelRight", 17, 19),
    cubiclePost: pixelOfficeSprite("props", "cubiclePost", 4, 27),
    windowLeft: pixelOfficeSprite("props", "windowLeft", 26, 21),
    windowRight: pixelOfficeSprite("props", "windowRight", 26, 21),
    boothDoor: pixelOfficeSprite("props", "boothDoor", 16, 31),
    sofaGray: pixelOfficeSprite("props", "sofaGray", 33, 15),
    sofaBlue: pixelOfficeSprite("props", "sofaBlue", 33, 16),
    sofaGreen: pixelOfficeSprite("props", "sofaGreen", 33, 16),
    sofaOrange: pixelOfficeSprite("props", "sofaOrange", 33, 16),
    vending: pixelOfficeSprite("props", "vending", 24, 34),
    bookshelf: pixelOfficeSprite("props", "bookshelf", 24, 31),
    plant: pixelOfficeSprite("props", "plant", 14, 19),
    calendar: pixelOfficeSprite("props", "calendar", 17, 11),
    workstation: pixelOfficeSprite("props", "workstation", 15, 19),
    cooler: pixelOfficeSprite("props", "cooler", 9, 17),
    tower: pixelOfficeSprite("props", "tower", 6, 19),
    clock: pixelOfficeSprite("props", "clock", 19, 6),
    mug: pixelOfficeSprite("props", "mug", 7, 11),
    artWarm: pixelOfficeSprite("props", "artWarm", 12, 9),
    artUk: pixelOfficeSprite("props", "artUk", 12, 9),
    artUs: pixelOfficeSprite("props", "artUs", 12, 9),
    filePurple: pixelOfficeSprite("props", "filePurple", 11, 8),
    fileBlue: pixelOfficeSprite("props", "fileBlue", 11, 8),
    fileGreen: pixelOfficeSprite("props", "fileGreen", 11, 8),
    badge: pixelOfficeSprite("props", "badge", 9, 9),
    paper: pixelOfficeSprite("props", "paper", 11, 8),
    socket: pixelOfficeSprite("props", "socket", 10, 6),
    catBlack: pixelOfficeSprite("props", "catBlack", 13, 13),
    catSleep: pixelOfficeSprite("props", "catSleep", 24, 11)
  }
} as const;
