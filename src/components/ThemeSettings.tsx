import type { ChangeEvent } from "react";
import type { AppTheme } from "../themes";
import { themeOptions } from "../themes";

function isAppTheme(value: string): value is AppTheme {
  return themeOptions.some((option) => option.value === value);
}

interface ThemeSettingsProps {
  theme: AppTheme;
  saving: boolean;
  disabled: boolean;
  onThemeChange: (theme: AppTheme) => void;
}

export function ThemeSettings({ theme, saving, disabled, onThemeChange }: ThemeSettingsProps) {
  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.currentTarget.value;
    if (isAppTheme(value)) onThemeChange(value);
  }

  return (
    <div className="theme-settings">
      <label htmlFor="theme-picker">Theme</label>
      <select id="theme-picker" aria-label="Color theme" value={theme} disabled={disabled || saving} onChange={handleChange}>
        {themeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
      {saving && <span className="theme-saving" role="status">Saving theme…</span>}
    </div>
  );
}
