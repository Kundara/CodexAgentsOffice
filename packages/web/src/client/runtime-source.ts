import { MULTIPLAYER_SCRIPT } from "./multiplayer-source";
import { SCENE_GRID_SCRIPT } from "./scene-grid-source";
import { TOAST_SCRIPT } from "./toast-source";
import { CLIENT_RUNTIME_BOOTSTRAP_SOURCE } from "./runtime/bootstrap-source";
import { CLIENT_RUNTIME_LAYOUT_SOURCE } from "./runtime/layout-source";
import { CLIENT_RUNTIME_MESSAGE_FILTER_SOURCE } from "./runtime/message-filter-source";
import { CLIENT_RUNTIME_NAVIGATION_SOURCE } from "./runtime/navigation-source";
import { CLIENT_RUNTIME_RENDER_SOURCE } from "./runtime/render-source";
import { CLIENT_RUNTIME_SCENE_SOURCE } from "./runtime/scene-source";
import { CLIENT_RUNTIME_SEATING_SOURCE } from "./runtime/seating-source";
import { CLIENT_RUNTIME_SETTINGS_SOURCE } from "./runtime/settings-source";
import { CLIENT_RUNTIME_UI_SOURCE } from "./runtime/ui-source";

const RUNTIME_SECTIONS = [
  CLIENT_RUNTIME_BOOTSTRAP_SOURCE,
  CLIENT_RUNTIME_SETTINGS_SOURCE,
  SCENE_GRID_SCRIPT,
  TOAST_SCRIPT,
  MULTIPLAYER_SCRIPT,
  CLIENT_RUNTIME_LAYOUT_SOURCE,
  CLIENT_RUNTIME_SEATING_SOURCE,
  CLIENT_RUNTIME_RENDER_SOURCE,
  CLIENT_RUNTIME_MESSAGE_FILTER_SOURCE,
  CLIENT_RUNTIME_SCENE_SOURCE,
  CLIENT_RUNTIME_NAVIGATION_SOURCE,
  CLIENT_RUNTIME_UI_SOURCE
];

export const CLIENT_RUNTIME_SOURCE = RUNTIME_SECTIONS.join("");
