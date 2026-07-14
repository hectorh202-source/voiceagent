export function BulkActionBar({
  count,
  onMarkRead,
  onMarkUnread,
  onMarkRecovered,
  onMarkNotRecovered,
  onClear,
}: {
  count: number;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onMarkRecovered: () => void;
  onMarkNotRecovered: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="bulk-action-bar">
      <strong>{count} selected</strong>
      <button className="btn" onClick={onMarkRead}>
        Mark as read
      </button>
      <button className="btn" onClick={onMarkUnread}>
        Mark as unread
      </button>
      <button className="btn" onClick={onMarkRecovered}>
        Mark as recovered
      </button>
      <button className="btn" onClick={onMarkNotRecovered}>
        Mark as not recovered
      </button>
      <button className="link-btn" onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}
