import { useEffect, useState, useRef } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

interface LocationData {
  latitude: number;
  longitude: number;
  lastUpdated: any;
}

export function useGPSTracking(driverId: string | undefined, isActive: boolean) {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOutOfZone, setIsOutOfZone] = useState(false);
  const startLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const GEOFENCE_RADIUS_KM = 5; // 5km radius

  // Haversine formula to calculate distance between two points
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  useEffect(() => {
    if (!driverId || !isActive) return;

    let watchId: number;

    const startTracking = () => {
      if (!navigator.geolocation) {
        setError("Geolocation is not supported by your browser");
        return;
      }

      watchId = navigator.geolocation.watchPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          
          if (!startLocationRef.current) {
            startLocationRef.current = { lat: latitude, lng: longitude };
          }

          // Check geofence
          const distance = calculateDistance(
            startLocationRef.current.lat,
            startLocationRef.current.lng,
            latitude,
            longitude
          );

          if (distance > GEOFENCE_RADIUS_KM) {
            setIsOutOfZone(true);
          } else {
            setIsOutOfZone(false);
          }

          const locationData = {
            driverId,
            latitude,
            longitude,
            lastUpdated: serverTimestamp(),
            startLatitude: startLocationRef.current.lat,
            startLongitude: startLocationRef.current.lng
          };

          try {
            await setDoc(doc(db, 'locations', driverId), locationData);
            setLocation({ latitude, longitude, lastUpdated: new Date() });
            setError(null);
          } catch (err) {
            console.error("Error updating location:", err);
          }
        },
        (err) => {
          console.error("Geolocation error:", err);
          if (err.code === 1) {
            setError("Location permission denied. Please enable GPS to continue.");
          } else {
            setError("Unable to retrieve location. Retrying...");
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    };

    startTracking();

    return () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
    };
  }, [driverId, isActive]);

  return { location, error, isOutOfZone };
}
