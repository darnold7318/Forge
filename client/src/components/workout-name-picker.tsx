import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface TemplateOption {
  id: number;
  name: string;
}

export function WorkoutNamePicker({ value, templates, selectedTemplateId, disabled, onTemplate, onCustomName }: {
  value: string;
  templates: TemplateOption[];
  selectedTemplateId: number | null;
  disabled: boolean;
  onTemplate: (id: number) => void;
  onCustomName: (name: string) => void;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setHighlighted(-1);
      setText(value);
    }
  }, [disabled, value]);

  const matches = templates.filter((template) => !filter || template.name.toLowerCase().includes(text.trim().toLowerCase()));
  const exact = templates.find((template) => template.name.trim().toLowerCase() === text.trim().toLowerCase());
  const commit = (template?: TemplateOption) => {
    setOpen(false);
    setHighlighted(-1);
    if (disabled) return;
    const selected = template ?? exact;
    if (selected) {
      setText(selected.name);
      if (selected.id !== selectedTemplateId) onTemplate(selected.id);
    } else {
      setText(text.trim());
      if (text.trim() !== value || selectedTemplateId != null) onCustomName(text.trim());
    }
  };

  return (
    <div className="relative" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit();
    }}>
      <Input
        ref={input}
        id="workout-name"
        role="combobox"
        aria-expanded={open}
        aria-controls="workout-template-options"
        aria-autocomplete="list"
        aria-activedescendant={open && highlighted >= 0 ? `workout-template-option-${matches[highlighted]?.id}` : undefined}
        aria-describedby="workout-name-help"
        autoComplete="off"
        placeholder="Choose a template or type a custom name"
        className="pr-10"
        value={text}
        disabled={disabled}
        onFocus={() => { setFilter(false); setOpen(true); setHighlighted(-1); }}
        onChange={(event) => { setText(event.target.value); setFilter(true); setOpen(true); setHighlighted(-1); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setText(value);
            setOpen(false);
            setHighlighted(-1);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setHighlighted((index) => matches.length === 0 ? -1 : event.key === "ArrowDown"
              ? (index + 1) % matches.length
              : (index <= 0 ? matches.length - 1 : index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            commit(open && highlighted >= 0 ? matches[highlighted] : undefined);
          }
        }}
        data-testid="input-workout-name"
      />
      <Button
        type="button" variant="ghost" size="icon"
        className="absolute right-0 top-0 h-9 w-9"
        aria-label="Choose workout template" aria-expanded={open} aria-controls="workout-template-options"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { input.current?.focus(); setFilter(false); setHighlighted(-1); setOpen(!open); }}
        data-testid="button-open-template-picker"
      ><ChevronDown className="h-4 w-4" /></Button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <div id="workout-template-options" role="listbox" aria-label="Workout templates">
            {matches.map((template, index) => (
              <div
                key={template.id} id={`workout-template-option-${template.id}`} role="option"
                aria-selected={selectedTemplateId === template.id}
                className={`flex cursor-pointer items-center justify-between rounded-sm px-3 py-2 text-sm hover:bg-accent ${highlighted === index ? "bg-accent" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(template)}
                data-testid={`button-select-template-${template.id}`}
              >{template.name}{selectedTemplateId === template.id && <Check className="h-4 w-4" />}</div>
            ))}
          </div>
          {!exact && <p className="px-3 py-2 text-xs text-muted-foreground">Press Enter or leave this field to start a manual workout{text.trim() ? ` named “${text.trim()}”` : ""}.</p>}
        </div>
      )}
    </div>
  );
}
