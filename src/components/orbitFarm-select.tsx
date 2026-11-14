import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './orbitFarm-select.css';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** A single-select listbox; focus stays on the labelled trigger while navigating. */
export function Select({ label, value, options, onChange, disabled = false }: SelectProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const [side, setSide] = useState<'top' | 'bottom'>('bottom');
  const labelId = `${id}-label`;
  const menuId = `${id}-options`;

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      // The visual viewport can lag the layout viewport during a device resize.
      const viewportWidth = Math.min(viewport?.width ?? window.innerWidth, window.innerWidth);
      const viewportHeight = Math.min(viewport?.height ?? window.innerHeight, window.innerHeight);
      const padding = 12;
      const gap = 7;
      if (rect.bottom <= viewportTop || rect.top >= viewportTop + viewportHeight) {
        setOpen(false);
        return;
      }
      const below = Math.max(0, viewportTop + viewportHeight - padding - rect.bottom - gap);
      const above = Math.max(0, rect.top - viewportTop - padding - gap);
      const desiredHeight = Math.min(288, (menuRef.current?.scrollHeight ?? options.length * 42 + 12) + 2);
      const nextSide = below >= desiredHeight || below >= above ? 'bottom' : 'top';
      const maxHeight = Math.min(288, nextSide === 'bottom' ? below : above);
      const width = Math.min(rect.width, viewportWidth - padding * 2);
      const height = Math.min(desiredHeight, maxHeight);
      const top = nextSide === 'bottom' ? rect.bottom + gap : rect.top - gap - height;
      const left = Math.max(viewportLeft + padding, Math.min(rect.left, viewportLeft + viewportWidth - padding - width));
      const boundedTop = Math.max(viewportTop + padding, Math.min(top, viewportTop + viewportHeight - padding - height));
      setSide(nextSide);
      setPosition({
        // CSS clamps also apply between a viewport resize and React's next render.
        left: `clamp(12px, ${left}px, calc(100vw - min(${width}px, 100vw - 24px) - 12px))`,
        width,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: `min(${maxHeight}px, calc(100dvh - 24px))`,
        top: `clamp(12px, ${boundedTop}px, calc(100dvh - min(${height}px, 100dvh - 24px) - 12px))`,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const show = (index = selectedIndex) => {
    searchRef.current = { text: '', at: 0 };
    setActiveIndex(index);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) show();
      else setActiveIndex((index) => Math.max(0, Math.min(last, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : last;
      if (open) setActiveIndex(index);
      else show(index);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex);
      else show();
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const at = Date.now();
      const previous = open && at - searchRef.current.at < 700 ? searchRef.current.text : '';
      const text = previous + event.key.toLocaleLowerCase();
      searchRef.current = { text, at };
      const repeating = [...text].every((character) => character === text[0]);
      const prefix = repeating ? text[0] : text;
      const start = open ? activeIndex : selectedIndex;
      const indices = options.map((_, index) => (start + index + 1) % options.length);
      // Extending a prefix refines the current match; repeated letters cycle matches.
      const matches = (index: number) => options[index].label.toLocaleLowerCase().startsWith(prefix);
      const match = previous && !repeating && matches(start) ? start : indices.find(matches);
      if (match !== undefined) {
        setActiveIndex(match);
        setOpen(true);
      }
    }
  };

  return (
    <label className="of-select-field" htmlFor={id}>
      <span id={labelId}>{label}</span>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        className="of-select-trigger"
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        disabled={disabled || options.length === 0}
        onClick={() => open ? setOpen(false) : show()}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className="of-select-value">{options[selectedIndex]?.label ?? 'Choose an option'}</span>
        <ChevronDown className="of-select-chevron" size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="listbox"
          aria-labelledby={labelId}
          className="of-select-menu"
          data-side={side}
          style={position}
          onPointerDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`of-select-option${activeIndex === index ? ' is-active' : ''}`}
              data-index={index}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={16} strokeWidth={2} aria-hidden="true" />}
            </div>
          ))}
        </div>, document.body,
      )}
    </label>
  );
}
