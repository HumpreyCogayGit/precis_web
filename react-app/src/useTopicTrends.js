import { useEffect, useState } from 'react';
import axios from 'axios';

// One fetch of /api/topic-trends for both home-page trending sections. Best-effort,
// like Top Stories: a failure leaves both sections out rather than blocking the
// edition. Every window comes back at once, so the toggles never refetch. The limit is
// the API maximum so each section's "Show all" already has every ranked category.
export default function useTopicTrends(apiBaseUrl, limit = 50) {
  const [trends, setTrends] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/api/topic-trends?limit=${limit}`);
        if (!cancelled && response.data?.windows) {
          setTrends(response.data);
        }
      } catch (err) {
        console.error('Error fetching topic trends:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, limit]);

  return trends;
}
