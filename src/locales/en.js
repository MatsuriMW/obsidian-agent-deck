// Agent Deck — English string table.
//
// One fragment per module group so several files can be translated
// independently and nothing has to be rewritten into a single giant file.
// Duplicate keys are a bug: the later fragment would silently win, so
// test/i18n.test.mjs checks for them.

import main from "./en/main.js";
import view from "./en/view.js";
import settings from "./en/settings.js";
import dialogs from "./en/dialogs.js";
import writers from "./en/writers.js";
import runtime from "./en/runtime.js";
import menubar from "./en/menubar.js";
import editor from "./en/editor.js";

export const fragments = { main, view, settings, dialogs, writers, runtime, menubar, editor };

export default Object.assign({}, main, view, settings, dialogs, writers, runtime, menubar, editor);
