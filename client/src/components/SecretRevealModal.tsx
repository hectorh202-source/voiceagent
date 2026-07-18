import { useState } from "react";
import { CheckIcon, CopyIcon, CloseIcon } from "./icons";

interface SecretRevealModalProps {
  title: string;
  secret: string;
  description: string;
  onClose: () => void;
}

// Shows a just-generated secret once, in-app, instead of the plain inline
// text that used to appear at the bottom of the page (easy to miss, and
// looked like every other form-saved message rather than a one-time
// disclosure worth pausing on). Nothing re-fetches this value — the server
// never returns a secret's plaintext again after this response, so once
// this modal is closed the secret is gone from the UI for good.
export function SecretRevealModal({ title, secret, description, onClose }: SecretRevealModalProps) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <CloseIcon width={18} height={18} />
          </button>
        </div>
        <div className="modal-body secret-reveal-body">
          <div className="modal-icon-circle success">
            <CheckIcon width={22} height={22} />
          </div>
          <p className="muted">{description}</p>
          <div className="secret-reveal-box">
            <code>{secret}</code>
            <button type="button" className="icon-btn" onClick={copy} title="Copy to clipboard">
              {copied ? <CheckIcon width={15} height={15} /> : <CopyIcon width={15} height={15} />}
            </button>
          </div>
          {copied && <div className="secret-copied-hint">Copied to clipboard</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
