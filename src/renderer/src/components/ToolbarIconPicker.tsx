import { useId } from 'react';
import { TOOLBAR_ICONS, type ToolbarIcon as Icon } from '../../../shared/toolbar';
import { ToolbarIcon, toolbarIconLabel } from './ToolbarIcon';
import { useT } from '../i18n';

/** Native radio controls provide keyboard selection; every option shows its actual symbol. */
export function ToolbarIconPicker({ value, onChange }: { value: Icon; onChange: (icon: Icon) => void }) {
  const { t } = useT();
  const name = useId();
  return <fieldset className="toolbar-icon-picker">
    <legend>{t('toolbar:icon')}</legend>
    <div className="toolbar-icon-grid">
      {TOOLBAR_ICONS.map(icon => <label className="toolbar-icon-option" key={icon} title={toolbarIconLabel(icon)}>
        <input type="radio" name={name} value={icon} checked={value === icon} aria-label={toolbarIconLabel(icon)} onChange={() => onChange(icon)} />
        <ToolbarIcon icon={icon} />
      </label>)}
    </div>
  </fieldset>;
}
