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
  
    // If no match, return the raw string (fallback)
    return dateString;
  }
  