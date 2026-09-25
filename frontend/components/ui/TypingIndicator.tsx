/** Three-dot bouncing typing indicator, styled like the counterpart's
 *  message bubbles (left-aligned, same bubble shape) so it reads as "they're
 *  about to send something" in the same visual language as their messages. */
export default function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1" aria-label="Typing…">
        <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms', animationDuration: '900ms' }} />
        <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms', animationDuration: '900ms' }} />
        <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms', animationDuration: '900ms' }} />
      </div>
    </div>
  );
}
