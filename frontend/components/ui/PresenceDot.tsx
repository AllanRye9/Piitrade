interface Props {
  online: boolean;
  /** Sizing context — 'sm' for the conversation-list avatar (smaller dot,
   *  thinner ring), 'md' for the thread header. */
  size?: 'sm' | 'md';
  className?: string;
}

/** Green = online (active within the last 2 minutes — see ONLINE_WINDOW_MS
 *  in the backend's messages.ts), grey = offline. The white ring keeps the
 *  dot legible against any avatar photo behind it. */
export default function PresenceDot({ online, size = 'sm', className = '' }: Props) {
  const dimension = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';
  const ring = size === 'sm' ? 'ring-2' : 'ring-[3px]';
  return (
    <span
      aria-hidden="true"
      className={`absolute bottom-0 right-0 ${dimension} rounded-full ${ring} ring-white ${online ? 'bg-emerald-500' : 'bg-gray-300'} ${className}`}
    />
  );
}
