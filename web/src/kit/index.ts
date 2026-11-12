/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit
 * The only building blocks pages use. No raw <button>/<input>/<select>/<textarea>/<a>/<summary> in a
 * page (scripts/check-help.mjs fails the build), and every control carries `help` (a HelpKey, an
 * inline { ar, en } text from module data, or false on an IconButton with an aria-label).
 * ════════════════════════════════════════════════════════════════════════════ */

export { Button, IconButton, ButtonRow } from './Button';
export type { ButtonProps, ButtonKind, IconButtonProps } from './Button';

export { Field, SettingRow, useField } from './Field';
export type { FieldProps, SettingRowProps, SettingMeta } from './Field';

export { TextInput, TextArea, NumberInput, Switch, Segmented, SliderNumber } from './inputs';
export type { TextInputProps, TextAreaProps, NumberInputProps, SwitchProps, SegmentedProps, SegmentOption, SliderNumberProps } from './inputs';

export { Select, Combobox } from './Listbox';
export type { Option, SelectProps, ComboboxProps } from './Listbox';

export { CitizenIdInput, CitizenChip, useCitizenPreview, citizenFromPlayers, sameCitizen, CoordsInput, parseCoords, DurationPicker, ReasonField } from './special';
export type { CitizenIdInputProps, CitizenState, CoordsValue, CoordsInputProps, DurationPickerProps, ReasonFieldProps } from './special';

export {
  PageHeader, PageActions, PageActionsSlotProvider, Section, Tabs, FilterChips, Toolbar, SplitView, Drawer, SettingsLayout, SaveBar,
} from './layout';
export type { PageHeaderProps, SectionProps, TabItem, TabsProps, ChipItem, DrawerProps, SettingsNavItem, SettingsLayoutProps, SaveBarProps } from './layout';

export { DataTable, KeyValue, KeyValueList, CopyButton, StatTile, Meter, StatusChip, Tag, EmptyState, Skeleton, Loading, InlineAlert } from './data';
export type { Column, SortState, DataTableProps, KeyValueProps, StatTileProps, Status, InlineAlertProps } from './data';

export { ConfirmDialog, DialogHost, TypeToConfirmDialog } from './dialog';
export type { ConfirmSpec, TypeToConfirmDialogProps } from './dialog';

export { default as Toasts } from './Toasts';
export { Gate, LockLine, useGate, useLevel, useLock } from './Gate';
export { default as Glyph } from './Glyph';
export type { GlyphName } from './Glyph';

export {
  cls, clamp, fmtNum, fmtCash, fmtGold, fmtDuration, fmtMinutes, fmtAgo, fmtDate, fmtDist, fmtCoords, vec3, vec4, pad2,
  isPermanentBan, distance, isTypingTarget, copyText, uid, parseCitizen,
} from './format';
export type { CitizenParse } from './format';

/* the help system, re-exported so a page imports everything from '../../kit' */
export { HelpTip, useHelp, inlineHelp, pickText } from '../help';
export type { HelpKey, HelpProp, HelpInline, HelpFacts } from '../help';

/* 2.8.0 the notebook look: places in words, «خيارات متقدمة», the readiness line */
export { Fold, ReadyLine, Where } from './notebook';
export { useWhere, placeText, placeName, placeFar, missingLine, zoneOf } from './where';
