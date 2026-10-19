type MilestoneTitleProps = {
  index: number;
  label?: string | null;
  titleClassName?: string;
  descriptionClassName?: string;
};

export function MilestoneTitle({
  index,
  label,
  titleClassName = "font-medium text-zinc-900",
  descriptionClassName = "mt-0.5 text-sm text-zinc-500",
}: MilestoneTitleProps) {
  const description = label?.trim() ?? "";

  return (
    <div>
      <p className={titleClassName}>Milestone {index + 1}</p>
      {description ? <p className={`whitespace-pre-line ${descriptionClassName}`}>{description}</p> : null}
    </div>
  );
}
