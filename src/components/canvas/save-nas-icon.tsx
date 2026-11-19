export function SaveNasIcon({ className = "size-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
            <path d="M12 3v8" />
            <path d="m8 7 4 4 4-4" />
            <rect x="2" y="13" width="20" height="8" rx="2" />
            <path d="M6 17h.01" />
            <path d="M10 17h4" />
        </svg>
    );
}
