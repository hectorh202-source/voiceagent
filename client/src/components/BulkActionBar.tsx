export function BulkActionBar({
  count,
  onMarkRead,
  onMarkUnread,
  onMarkRecovered,
  onMarkNotRecovered,
  onClear,
  onDelete,
  canDelete,
}: {
  count: number;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onMarkRecovered: () => void;
  onMarkNotRecovered: () => void;
  onClear: () => void;
  // Both optional — callers that don't pass onDelete/canDelete (none exist
  // yet, but this component has no other consumers today) simply don't get
  // a Delete button, rather than every call site needing to wire this up.
  onDelete?: () => void;
  canDelete?: boolean;
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
      {canDelete && onDelete && (
        <button className="btn btn-danger" onClick={onDelete}>
          Delete
        </button>
      )}
      <button className="link-btn" onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}
