import { createPortal } from 'react-dom';
import { MapPin, X } from 'lucide-react';

export default function LocationModal({ onAllow, onDismiss }) {
  return createPortal(
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onDismiss} aria-label="Close"><X size={13} /></button>
        <div className="modal-icon"><MapPin size={28} /></div>
        <h3>Use Your Location?</h3>
        <p>
          Trip Planner would like to use your location to calculate accurate
          travel distances and times. This stays on your device.
        </p>
        <div className="modal-actions">
          <button type="button" className="modal-dismiss" onClick={onDismiss}>Not now</button>
          <button type="button" className="modal-allow" onClick={onAllow}>Allow</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
