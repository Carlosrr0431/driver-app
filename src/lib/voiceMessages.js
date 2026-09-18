export function mergeVoiceMessage(list, message) {
  if (!message?.id) return Array.isArray(list) ? list : [];
  const prev = Array.isArray(list) ? list : [];
  if (prev.some((item) => item.id === message.id)) {
    return prev.map((item) => (item.id === message.id ? { ...item, ...message } : item));
  }
  return [...prev, message].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

export function mergeVoiceMessages(list, incoming = []) {
  return (incoming || []).reduce(
    (acc, message) => mergeVoiceMessage(acc, message),
    list || []
  );
}
