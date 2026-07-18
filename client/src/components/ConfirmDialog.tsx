import { AlertIcon } from "./icons";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// A styled in-app replacement for window.confirm() — used for actions
// serious enough to warrant more than a plain OS dialog (e.g. regenerating a
// secret a live integration already depends on, see
// GeneralSettingsPage.tsx). A native confirm() also can't be restyled or
// automated-tested reliably, since it blocks on the browser's own dialog
// rather than rendering as part of the page.
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-dialog-body">
          <div className="modal-icon-circle warning">
            <AlertIcon width={22} height={22} />
          </div>
          <h2>{title}</h2>
          <p className="muted">{message}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
