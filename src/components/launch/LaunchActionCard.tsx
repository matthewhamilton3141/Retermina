import Icon, { type IconName } from "../Icon";

/** A primary action shown in the Launch Hub "Start" grid. */
export interface LaunchAction {
  id: string;
  icon: IconName;
  label: string;
  description: string;
  onSelect?: () => void;
}

export function LaunchActionCard({ action }: { action: LaunchAction }) {
  return (
    <button
      type="button"
      onClick={action.onSelect}
      className="rt-card group flex flex-col gap-3 p-5 text-left transition hover:-translate-y-0.5"
    >
      <span className="rt-card-icon flex h-11 w-11 items-center justify-center">
        <Icon name={action.icon} size={22} />
      </span>
      <span className="block">
        <span className="block text-sm font-semibold">{action.label}</span>
        <span className="rt-text-muted mt-0.5 block text-xs">
          {action.description}
        </span>
      </span>
    </button>
  );
}

export default LaunchActionCard;
