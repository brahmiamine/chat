/** Lucide icon paths (stroke 1.75) inlined to keep the bundle tiny, plus the Lueur star mark. */
import { cloneElement, type ReactElement } from 'react';

type Part = string | ReactElement;

function Svg({ parts, size = 18, fill, className }: { parts: Part[]; size?: number; fill?: boolean; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {parts.map((p, i) => (typeof p === 'string' ? <path key={i} d={p} /> : cloneElement(p, { key: i })))}
    </svg>
  );
}

export interface IconProps { size?: number; className?: string }

const icon = (parts: Part[], defaultSize = 18, fill = false) =>
  function Icon({ size = defaultSize, className }: IconProps) {
    return <Svg parts={parts} size={size} fill={fill} className={className} />;
  };

const STAR = 'M12 2.5c.4 0 .7.3.8.6l1.5 4.9c.2.6.6 1 1.2 1.2l4.9 1.5c.4.1.6.4.6.8s-.3.7-.6.8l-4.9 1.5c-.6.2-1 .6-1.2 1.2l-1.5 4.9c-.1.4-.4.6-.8.6s-.7-.3-.8-.6l-1.5-4.9c-.2-.6-.6-1-1.2-1.2l-4.9-1.5c-.4-.1-.6-.4-.6-.8s.3-.7.6-.8l4.9-1.5c.6-.2 1-.6 1.2-1.2l1.5-4.9c.1-.4.4-.6.8-.6z';
const GEAR = 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z';
const COPY: Part[] = [<rect x={8} y={8} width={14} height={14} rx={2} />, 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'];
const FILE_BASE = ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4'];

export const StarIcon = icon([STAR], 18, true);
export const PlusIcon = icon(['M5 12h14', 'M12 5v14']);
export const PanelIcon = icon([<rect x={3} y={3} width={18} height={18} rx={2} />, 'M9 3v18']);
export const SearchIcon = icon([<circle cx={11} cy={11} r={7.5} />, 'm20.5 20.5-4.2-4.2']);
export const MoreIcon = icon([<circle cx={12} cy={12} r={1} />, <circle cx={19} cy={12} r={1} />, <circle cx={5} cy={12} r={1} />]);
export const PencilIcon = icon(['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z', 'm15 5 4 4'], 16);
export const TrashIcon = icon(['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2', 'M10 11v6', 'M14 11v6'], 16);
export const SettingsIcon = icon([GEAR, <circle cx={12} cy={12} r={3} />]);
export const ChevronIcon = icon(['m6 9 6 6 6-6'], 16);
export const ChevronLeftIcon = icon(['m15 18-6-6 6-6'], 20);
export const ChevronRightIcon = icon(['m9 18 6-6-6-6'], 20);
export const ArrowUpIcon = icon(['m5 12 7-7 7 7', 'M12 19V5']);
export const ArrowDownIcon = icon(['M12 5v14', 'm19 12-7 7-7-7']);
export const StopIcon = icon([<rect x={6.5} y={6.5} width={11} height={11} rx={2} />], 18, true);
export const CopyIcon = icon(COPY, 16);
export const CheckIcon = icon(['M20 6 9 17l-5-5'], 16);
export const RefreshIcon = icon(['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'], 16);
export const MenuIcon = icon(['M4 6h16', 'M4 12h16', 'M4 18h10'], 20);
export const XIcon = icon(['M18 6 6 18', 'm6 6 12 12']);
export const CodeIcon = icon(['m16 18 6-6-6-6', 'm8 6-6 6 6 6'], 16);
export const BugIcon = icon(['m8 2 1.88 1.88', 'M14.12 3.88 16 2', 'M9 7.13v-1a3.003 3.003 0 1 1 6 0v1', 'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6', 'M12 20v-9', 'M6.53 9C4.6 8.8 3 7.1 3 5', 'M6 13H2', 'M3 21c0-2.1 1.7-3.9 3.8-4', 'M20.97 5c0 2.1-1.6 3.8-3.5 4', 'M22 13h-4', 'M17.2 17c2.1.1 3.8 1.9 3.8 4'], 16);
export const BulbIcon = icon(['M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5', 'M9 18h6', 'M10 22h4'], 16);
export const PenLineIcon = icon(['M12 20h9', 'M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z'], 16);
export const SquarePenIcon = icon(['M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z'], 20);
export const SunIcon = icon([<circle cx={12} cy={12} r={4} />, 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'], 15);
export const MoonIcon = icon(['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'], 15);
export const MonitorIcon = icon([<rect x={2} y={3} width={20} height={14} rx={2} />, 'M8 21h8', 'M12 17v4'], 15);
export const AlertIcon = icon([<circle cx={12} cy={12} r={10} />, 'M12 8v4', 'M12 16h.01']);
export const FileIcon = icon(FILE_BASE, 16);
export const FileTextIcon = icon([...FILE_BASE, 'M10 9H8', 'M16 13H8', 'M16 17H8'], 16);
export const FileCodeIcon = icon([...FILE_BASE, 'm10 12.5-2 2 2 2', 'm14 16.5 2-2-2-2'], 16);
export const ImageIcon = icon([<rect x={3} y={3} width={18} height={18} rx={2} />, <circle cx={9} cy={9} r={2} />, 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'], 16);
export const PaperclipIcon = icon(['m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48']);
export const UploadIcon = icon(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'], 28);
export const DownloadIcon = icon(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3']);
export const ZoomInIcon = icon([<circle cx={11} cy={11} r={7.5} />, 'm20.5 20.5-4.2-4.2', 'M11 8v6', 'M8 11h6']);
export const ZoomOutIcon = icon([<circle cx={11} cy={11} r={7.5} />, 'm20.5 20.5-4.2-4.2', 'M8 11h6']);
export const MessageIcon = icon(['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'], 16);
export const CpuIcon = icon([<rect x={4} y={4} width={16} height={16} rx={2} />, <rect x={9} y={9} width={6} height={6} rx={1} />, 'M15 2v2', 'M15 20v2', 'M2 15h2', 'M2 9h2', 'M20 15h2', 'M20 9h2', 'M9 2v2', 'M9 20v2'], 16);
export const PlugIcon = icon(['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z'], 16);
export const SlidersIcon = icon(['M21 4h-7', 'M10 4H3', 'M21 12h-9', 'M8 12H3', 'M21 20h-5', 'M12 20H3', 'M14 2v4', 'M8 10v4', 'M16 18v4'], 16);
export const ContrastIcon = icon([<circle cx={12} cy={12} r={10} />, 'M12 18a6 6 0 0 0 0-12v12z'], 16);
export const GearIcon = icon([GEAR, <circle cx={12} cy={12} r={3} />], 16);
export const EyeIcon = icon(['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', <circle cx={12} cy={12} r={3} />], 16);
export const EyeOffIcon = icon(['M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49', 'M14.084 14.158a3 3 0 0 1-4.242-4.242', 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143', 'm2 2 20 20'], 16);
