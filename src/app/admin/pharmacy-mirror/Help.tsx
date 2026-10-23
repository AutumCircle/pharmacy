'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mirrorHelp, type MirrorHelpTopic } from '@/lib/pharmacy-mirror-help';

export default function Help({ topic }: { topic: MirrorHelpTopic }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const textId = useId();
  const help = mirrorHelp[topic];
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="mirror-help-trigger"
        aria-label={`Пояснение: ${help.title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="mirror-help-dialog"
            aria-labelledby={titleId}
            aria-describedby={textId}
            onClose={() => setOpen(false)}
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
              )
                event.currentTarget.close();
            }}
          >
            <div className="mirror-help-dialog-top">
              <span aria-hidden="true">?</span>
              <button
                type="button"
                aria-label="Закрыть пояснение"
                onClick={() => dialog.current?.close()}
              >
                ×
              </button>
            </div>
            <h2 id={titleId}>{help.title}</h2>
            <p id={textId}>{help.text}</p>
            <button
              type="button"
              className="mirror-help-done"
              onClick={() => dialog.current?.close()}
            >
              Понятно
            </button>
          </dialog>,
          document.body,
        )}
    </>
  );
}
