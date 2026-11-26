type ClosedNoticeProps = {
  isRejected: boolean;
  hasFunded: boolean;
};

/** Red banner on a rejected or cancelled project. */
export function ClosedNotice({ isRejected, hasFunded }: ClosedNoticeProps) {
  return (
    <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm text-red-700">
        {isRejected
          ? "This project was rejected by the seller."
          : hasFunded
            ? "This project has been cancelled and all funds have been returned to the buyer."
            : "This project has been cancelled."}
      </p>
    </div>
  );
}
