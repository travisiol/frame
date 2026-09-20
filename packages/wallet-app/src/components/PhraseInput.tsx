import { useEffect, useMemo, useRef, useState } from "react";
import type { MnemonicPreview } from "@frame/types";
import { shortAddress } from "@frame/chain";
import { Icon, Identicon, cx } from "@frame/ui";
import { useBackend } from "../context";

const STANDARD_LENGTHS = [12, 15, 18, 21, 24];

/** Lowercase, letters only — what a BIP-39 word looks like once typed or pasted. */
function splitWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/**
 * Recovery-phrase entry: one box per word, like every other wallet (Phantom,
 * MetaMask, Rabby) — not a paragraph to paste into. Pasting the whole phrase
 * into any box fills every box; typing a space or Enter moves to the next
 * one; Backspace on an empty box moves back. Feedback attaches to the exact
 * box that is wrong, instead of a running word count nobody needs.
 */
export function PhraseInput({
  value,
  onChange,
  onPreview,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onPreview: (preview: MnemonicPreview | null) => void;
  error?: string | null;
  autoFocus?: boolean;
}) {
  const backend = useBackend();
  const [count, setCount] = useState(12);
  const [words, setWords] = useState<string[]>(() => Array(12).fill(""));
  const [preview, setPreview] = useState<MnemonicPreview | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // Push the joined phrase up to the parent (what actually gets submitted).
  useEffect(() => {
    onChange(words.join(" ").trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words]);

  // If the parent clears the value from outside (switching tabs), clear the boxes too.
  useEffect(() => {
    if (value === "" && words.some(Boolean)) setWords(Array(count).fill(""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const filled = useMemo(() => words.filter(Boolean), [words]);

  useEffect(() => {
    if (filled.length === 0 || filled.length !== count) {
      setPreview(null);
      onPreview(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      backend
        .previewMnemonic({ mnemonic: words.join(" ") })
        .then((p) => {
          if (cancelled) return;
          setPreview(p);
          onPreview(p);
        })
        .catch(() => {
          if (cancelled) return;
          setPreview(null);
          onPreview(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, count, filled.length]);

  const resize = (n: number) => {
    setCount(n);
    setWords((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? ""));
  };

  const setWord = (i: number, w: string) => {
    setWords((prev) => {
      const next = [...prev];
      next[i] = w.replace(/[^a-zA-Z]/g, "").toLowerCase();
      return next;
    });
  };

  const focusBox = (i: number) => window.setTimeout(() => refs.current[i]?.focus(), 0);

  const handlePaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = splitWords(e.clipboardData.getData("text"));
    if (pasted.length <= 1) return; // a single word: let the default paste happen
    e.preventDefault();
    if (STANDARD_LENGTHS.includes(pasted.length)) {
      // A full phrase, pasted anywhere: fill the whole grid from the start.
      setCount(pasted.length);
      setWords(pasted);
      focusBox(pasted.length - 1);
    } else {
      // A partial paste (e.g. a few words copied separately): fill from this box, without resizing the grid.
      setWords((prev) => {
        const next = [...prev];
        pasted.forEach((w, k) => {
          if (i + k < next.length) next[i + k] = w;
        });
        return next;
      });
      focusBox(Math.min(i + pasted.length, count) - 1);
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === " " || e.key === "Enter" || e.key === "Tab") && !e.shiftKey && i < count - 1) {
      e.preventDefault();
      focusBox(i + 1);
    } else if (e.key === "Backspace" && words[i] === "" && i > 0) {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === "ArrowLeft" && (e.target as HTMLInputElement).selectionStart === 0 && i > 0) {
      focusBox(i - 1);
    } else if (e.key === "ArrowRight" && (e.target as HTMLInputElement).selectionStart === words[i]?.length && i < count - 1) {
      focusBox(i + 1);
    }
  };

  const invalidAt = useMemo(() => new Set((preview?.invalidWords ?? []).map((w) => w.position - 1)), [preview]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Recovery phrase</span>
        <div className="inline-flex rounded-[10px] border border-line bg-surface p-0.5">
          {[12, 24].map((n) => (
            <button key={n} type="button" className={cx("h-6 rounded-[7px] px-2.5 text-[11px] font-semibold transition-colors", count === n ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2")} onClick={() => resize(n)}>
              {n} words
            </button>
          ))}
        </div>
      </div>
      <div className={cx("grid grid-cols-3 gap-2", error && "rounded-[12px] outline outline-1 outline-loss")}>
        {words.map((w, i) => (
          <div key={i} className={cx("card-flat flex items-center gap-1.5 px-2.5 py-2 text-[13px] transition-colors", invalidAt.has(i) && "border-loss")}>
            <span className="num w-4 shrink-0 text-[11px] text-ink-3">{i + 1}</span>
            <input
              ref={(el) => {
                refs.current[i] = el;
              }}
              data-word-box={i}
              type="text"
              className="min-w-0 flex-1 bg-transparent font-medium text-ink outline-none placeholder:text-ink-3"
              value={w}
              onChange={(e) => setWord(i, e.target.value)}
              onPaste={(e) => handlePaste(i, e)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              autoFocus={autoFocus && i === 0}
            />
          </div>
        ))}
      </div>
      {error ? (
        <div className="mt-1.5 text-[12px] text-loss">{error}</div>
      ) : (
        preview &&
        filled.length === count && (
          <div className="mt-2 text-[12px] leading-relaxed">
            {invalidAt.size > 0 ? (
              <span className="text-warn">
                {[...invalidAt].length === 1 ? `Word ${[...invalidAt][0]! + 1} is` : `${invalidAt.size} words are`} not in the recovery-phrase word list. Check the spelling.
              </span>
            ) : preview.checksumFailed ? (
              <span className="text-warn">These are all real words, but the phrase does not check out — one is out of order.</span>
            ) : preview.valid && preview.address ? (
              <span className="inline-flex flex-wrap items-center gap-1.5 text-ink-2">
                <Icon.Check size={13} className="shrink-0 text-accent" />
                Controls <Identicon address={preview.address} size={14} />
                <span className="mono text-ink">{shortAddress(preview.address, 6)}</span>
                {preview.alreadyInWallet && <span className="text-warn">· already in this wallet</span>}
              </span>
            ) : null}
          </div>
        )
      )}
    </div>
  );
}
