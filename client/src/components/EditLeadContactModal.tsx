import { useState } from "react";
import { CloseIcon } from "./icons";

interface EditLeadContactModalProps {
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  onSave: (values: { name: string | null; email: string | null; phone: string | null; address: string | null }) => void;
  onClose: () => void;
  isSaving: boolean;
}

// A blank field here means "leave it blank," not "unknown" — this always
// sends every field as an explicit value (including null for an emptied
// one), since LeadDetailPage.tsx's patchMutation/PATCH /leads treats a
// present-but-null field as "clear the override," distinct from omitting
// the field entirely (see db/inboundLeads.ts's InboundLeadPatch).
export function EditLeadContactModal({ name, email, phone, address, onSave, onClose, isSaving }: EditLeadContactModalProps) {
  const [nameDraft, setNameDraft] = useState(name ?? "");
  const [emailDraft, setEmailDraft] = useState(email ?? "");
  const [phoneDraft, setPhoneDraft] = useState(phone ?? "");
  const [addressDraft, setAddressDraft] = useState(address ?? "");

  function handleSave() {
    onSave({
      name: nameDraft.trim() === "" ? null : nameDraft.trim(),
      email: emailDraft.trim() === "" ? null : emailDraft.trim(),
      phone: phoneDraft.trim() === "" ? null : phoneDraft.trim(),
      address: addressDraft.trim() === "" ? null : addressDraft.trim(),
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Contact Details</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <CloseIcon width={18} height={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>Name</label>
            <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Customer name" />
          </div>
          <div className="form-row">
            <label>Email</label>
            <input value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder="customer@example.com" />
          </div>
          <div className="form-row">
            <label>Phone</label>
            <input value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} placeholder="+1 (555) 555-5555" />
          </div>
          <div className="form-row">
            <label>Address</label>
            <input value={addressDraft} onChange={(e) => setAddressDraft(e.target.value)} placeholder="123 Main St, City, State" />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
