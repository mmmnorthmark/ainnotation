import { KIND_META, type AnnotationCandidate } from '../analysis/types';

export function AnnotationCard({
  candidate,
  selected,
  text,
  onToggle,
  onEdit,
}: {
  candidate: AnnotationCandidate;
  selected: boolean;
  text: string;
  onToggle: () => void;
  onEdit: (text: string) => void;
}) {
  const meta = KIND_META[candidate.kind];
  return (
    <div className={`ann ${selected ? 'ann--on' : ''}`}>
      <label className="ann-head">
        <input type="checkbox" checked={selected} onChange={onToggle} />
        <span className={`ann-glyph ann-glyph--${candidate.kind}`} aria-hidden>
          {meta.glyph}
        </span>
        <span className="ann-title">{candidate.title}</span>
        <span className="ann-kind">{meta.label}</span>
      </label>

      <div className="ann-target">
        {candidate.target.length ? (
          candidate.target.map((t) => (
            <span key={t.fieldName} className="chip">
              <span className="chip-k">{t.fieldName}</span>
              {t.value}
            </span>
          ))
        ) : (
          <span className="chip chip--muted">whole sheet</span>
        )}
      </div>

      <textarea
        className="ann-text"
        value={text}
        rows={Math.min(5, text.split('\n').length)}
        spellCheck={false}
        aria-label={`Annotation text for ${candidate.label}`}
        onChange={(e) => onEdit(e.target.value)}
      />
    </div>
  );
}
