import { getEventLabel, formatDateTime } from "@/lib/formatters";

export type ProjectEvent = {
  type: string;
  timestamp: string;
  milestoneIndex: number | null;
};

type TimelineMilestone = {
  milestoneIndex: number;
  label?: string | null;
  status: string;
};

type ProjectTimelineProps = {
  events: ProjectEvent[];
  milestones: TimelineMilestone[];
};

const NEGATIVE_EVENTS = ["project_cancelled", "project_rejected"];
const FINISHED_STATUSES = ["PAID", "RESOLVED", "REFUNDED"];

/** Vertical list of everything that has happened in a project, oldest first. */
export function ProjectTimeline({ events, milestones }: ProjectTimelineProps) {
  if (events.length === 0) return null;

  const isProjectComplete =
    milestones.length > 0 && milestones.every((m) => FINISHED_STATUSES.includes(m.status));

  return (
    <div className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500 mb-6">Project Timeline</h2>
      <ol className="relative">
        {events.map((event, i) => {
          const isLast = i === events.length - 1 && !isProjectComplete;
          const isNegative = NEGATIVE_EVENTS.includes(event.type);
          const milestoneDescription = event.milestoneIndex === null
            ? ""
            : milestones.find((m) => m.milestoneIndex === event.milestoneIndex)?.label?.trim() ?? "";

          return (
            <li key={i} className="flex gap-4 relative">
              {!isLast && (
                <div className="absolute left-[9px] top-5 bottom-0 w-px bg-zinc-200" />
              )}
              <div className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center z-10 ${
                isNegative ? "border-red-300 bg-red-50" : "border-primary bg-primary/10"
              }`}>
                <div className={`h-2 w-2 rounded-full ${isNegative ? "bg-red-400" : "bg-primary"}`} />
              </div>
              <div className="pb-6">
                <p className="text-sm font-semibold text-zinc-900 leading-tight">
                  {getEventLabel(event.type, event.milestoneIndex)}
                </p>
                {milestoneDescription && (
                  <p className="text-xs text-zinc-600 mt-0.5">{milestoneDescription}</p>
                )}
                <p className="text-xs text-zinc-500 mt-0.5">{formatDateTime(event.timestamp)}</p>
              </div>
            </li>
          );
        })}
        {isProjectComplete && (
          <li className="flex gap-4 relative">
            <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-emerald-400 bg-emerald-50 flex items-center justify-center z-10">
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
            <div className="pb-0">
              <p className="text-sm font-semibold text-emerald-700 leading-tight">Project Completed</p>
              <p className="text-xs text-zinc-500 mt-0.5">{formatDateTime(events[events.length - 1].timestamp)}</p>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}
