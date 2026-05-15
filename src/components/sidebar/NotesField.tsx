import { useConfigStore } from '../../store/configStore';

const WORD_LIMIT = 200;

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

export function NotesField() {
  const notes = useConfigStore(s => s.notes);
  const set = useConfigStore(s => s.set);
  const wordCount = countWords(notes);
  const atLimit = wordCount >= WORD_LIMIT;

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    const words = value.trim() === '' ? [] : value.trim().split(/\s+/);
    if (words.length <= WORD_LIMIT) {
      set({ notes: value });
    } else {
      // Allow editing within already-over text (e.g. deleting), but block adding more words
      if (countWords(value) < countWords(notes)) {
        set({ notes: value });
      }
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        className="notes-textarea"
        rows={3}
        placeholder="Any special instructions, custom requests, or additional details…"
        value={notes}
        onChange={handleChange}
        autoComplete="off"
      />
      <div style={{ fontSize: 11, color: atLimit ? '#c0392b' : 'var(--text-muted)', textAlign: 'right', marginTop: 3 }}>
        {wordCount}/{WORD_LIMIT} words
      </div>
    </div>
  );
}
