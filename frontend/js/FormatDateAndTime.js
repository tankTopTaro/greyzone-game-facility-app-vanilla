export function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60

    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

export function formatDate(isoString) {
    if (!isoString) return 'No booking information'

    const date = new Date(isoString)
    return date.toLocaleString('en-US', {
       month: 'long',
       day: 'numeric',
       year: 'numeric',
       hour: 'numeric',
       minute: 'numeric',
       hour12: true
    })
}