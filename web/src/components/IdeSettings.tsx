import { useCallback, useEffect, useState } from "react";

/**
 * VS Code scopes settings per folder, in `.vscode/settings.json`. Each project
 * therefore carries its own editor config, exactly like a real workspace —
 * which is also why IDE settings stay separate from the app's own preferences.
 */
export interface IdeSettings {
  "editor.fontSize"?: number;
  "editor.tabSize"?: number;
  "editor.wordWrap"?: boolean;
  "terminal.fontSize"?: number;
  "files.autoSave"?: "off" | "afterDelay" | "onFocusChange";
  "editor.minimap.enabled"?: boolean;
}

export const DEFAULT_IDE_SETTINGS: Required<
  Pick<IdeSettings, "editor.fontSize" | "editor.tabSize" | "editor.wordWrap" | "terminal.fontSize" | "files.autoSave">
> = {
  "editor.fontSize": 12.5,
  "editor.tabSize": 2,
  "editor.wordWrap": false,
  "terminal.fontSize": 12,
  "files.autoSave": "off",
};

const NUMERIC: { key: keyof IdeSettings; label: string; min: number; max: number; step: number }[] = [
  { key: "editor.fontSize", label: "Editor font size", min: 9, max: 24, step: 0.5 },
  { key: "editor.tabSize", label: "Tab size", min: 1, max: 8, step: 1 },
  { key: "terminal.fontSize", label: "Terminal font size", min: 9, max: 20, step: 0.5 },
];

export function useIdeSettings(folder: string) {
  const [settings, setSettings] = useState<IdeSettings>(DEFAULT_IDE_SETTINGS);

  useEffect(() => {
    let live = true;
    if (!folder) return;
    fetch(`/api/fs/settings?path=${encodeURIComponent(folder)}`)
      .then((r) => r.json())
      .then((j) => {
        if (live && j?.settings) setSettings({ ...DEFAULT_IDE_SETTINGS, ...j.settings });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [folder]);

  const save = useCallback(
    (next: IdeSettings) => {
      setSettings(next);
      if (!folder) return;
      fetch("/api/fs/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folder, settings: next }),
      }).catch(() => undefined);
    },
    [folder],
  );

  return { settings, save };
}

export function IdeSettingsPanel({
  folder,
  settings,
  onChange,
  onClose,
}: {
  folder: string;
  settings: IdeSettings;
  onChange: (s: IdeSettings) => void;
  onClose: () => void;
}) {
  const num = (key: keyof IdeSettings, fallback: number) => Number(settings[key] ?? fallback);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ide-settings" onClick={(e) => e.stopPropagation()}>
        <div className="ide-settings-head">
          <h2>Settings</h2>
          <span className="ide-settings-scope" title={folder}>
            {folder}/.vscode/settings.json
          </span>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="ide-settings-body">
          {NUMERIC.map(({ key, label, min, max, step }) => (
            <label key={key} className="ide-settings-row">
              <span className="ide-settings-label">{label}</span>
              <input
                className="ide-settings-input"
                type="number"
                min={min}
                max={max}
                step={step}
                value={num(key, DEFAULT_IDE_SETTINGS[key as keyof typeof DEFAULT_IDE_SETTINGS] as number)}
                onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) })}
              />
            </label>
          ))}

          <label className="ide-settings-row">
            <span className="ide-settings-label">Word wrap</span>
            <input
              type="checkbox"
              checked={settings["editor.wordWrap"] ?? false}
              onChange={(e) => onChange({ ...settings, "editor.wordWrap": e.target.checked })}
            />
          </label>

          <label className="ide-settings-row">
            <span className="ide-settings-label">Auto save</span>
            <select
              className="ide-settings-input"
              value={settings["files.autoSave"] ?? "off"}
              onChange={(e) => onChange({ ...settings, "files.autoSave": e.target.value as IdeSettings["files.autoSave"] })}
            >
              <option value="off">off</option>
              <option value="afterDelay">afterDelay</option>
              <option value="onFocusChange">onFocusChange</option>
            </select>
          </label>
        </div>

        <p className="ide-settings-note">
          Saved into the project, not the app — so this folder keeps its own settings and stays separate from your
          other projects.
        </p>
      </div>
    </div>
  );
}
