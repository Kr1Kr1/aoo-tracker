export function parseDate(dateString) {
  const now = new Date();

  if (dateString.includes("Aujourd'hui")) {
    const time = dateString.split("à")[1].trim(); // Extract "17:23"
    const [hours, minutes] = time.split(":").map(Number);
    now.setHours(hours, minutes, 0, 0); // Update the time
    return now.toISOString();
  }

  if (dateString.includes("Hier")) {
    const time = dateString.split("à")[1].trim(); // Extract "23:22"
    const [hours, minutes] = time.split(":").map(Number);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1); // Go to yesterday
    yesterday.setHours(hours, minutes, 0, 0);
    return yesterday.toISOString();
  }

  // Handle DD/MM/YYYY à HH:mm format
  const match = dateString.match(/(\d{2})\/(\d{2})\/(\d{4})\s+à\s+(\d{2}):(\d{2})/);
  if (match) {
    const [_, day, month, year, hours, minutes] = match;
    const date = new Date(year, month - 1, day, hours, minutes);
    return date.toISOString();
  }

  // If no match, return current date (fallback)
  console.warn("[dateUtils] Could not parse date:", dateString);
  return now.toISOString();
}