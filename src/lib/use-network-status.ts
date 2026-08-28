import * as Network from 'expo-network';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export interface NetworkStatus {
  isConnected: boolean;
  connectionType: 'WIFI' | 'CELLULAR' | 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  label: string;
}

export function useNetworkStatus(): NetworkStatus {
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [connectionType, setConnectionType] = useState<'WIFI' | 'CELLULAR' | 'ONLINE' | 'OFFLINE' | 'UNKNOWN'>('UNKNOWN');

  useEffect(() => {
    let isMounted = true;

    async function checkNetwork() {
      try {
        if (Platform.OS === 'web') {
          const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
          if (isMounted) {
            setIsConnected(online);
            setConnectionType(online ? 'ONLINE' : 'OFFLINE');
          }
          return;
        }

        const state = await Network.getNetworkStateAsync();
        if (isMounted) {
          const online = Boolean(state.isConnected && state.isInternetReachable !== false);
          setIsConnected(online);
          if (state.type === Network.NetworkStateType.WIFI) {
            setConnectionType('WIFI');
          } else if (state.type === Network.NetworkStateType.CELLULAR) {
            setConnectionType('CELLULAR');
          } else {
            setConnectionType(online ? 'ONLINE' : 'OFFLINE');
          }
        }
      } catch {
        if (isMounted) {
          const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
          setIsConnected(online);
          setConnectionType(online ? 'ONLINE' : 'OFFLINE');
        }
      }
    }

    void checkNetwork();

    const interval = setInterval(() => {
      void checkNetwork();
    }, 3000);

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleOnline = () => {
        if (isMounted) {
          setIsConnected(true);
          setConnectionType('ONLINE');
        }
      };
      const handleOffline = () => {
        if (isMounted) {
          setIsConnected(false);
          setConnectionType('OFFLINE');
        }
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        isMounted = false;
        clearInterval(interval);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  let label = 'Online';
  if (!isConnected) {
    label = 'Offline';
  } else if (connectionType === 'WIFI') {
    label = 'Online (Wi-Fi)';
  } else if (connectionType === 'CELLULAR') {
    label = 'Online (Cellular)';
  } else {
    label = 'Online';
  }

  return {
    isConnected,
    connectionType,
    label,
  };
}
