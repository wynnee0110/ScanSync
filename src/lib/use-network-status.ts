import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export interface NetworkStatus {
  isConnected: boolean;
  connectionType: 'WIFI' | 'CELLULAR' | 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  label: string;
}

export async function getNetworkStatusAsync(): Promise<NetworkStatus> {
  if (Platform.OS === 'web') {
    const online = typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
    return {
      isConnected: online,
      connectionType: online ? 'ONLINE' : 'OFFLINE',
      label: online ? 'Online' : 'Offline',
    };
  }

  try {
    const Network = await import('expo-network');
    const state = await Network.getNetworkStateAsync();
    const online = Boolean(state.isConnected && state.isInternetReachable !== false);
    let connectionType: NetworkStatus['connectionType'] = online ? 'ONLINE' : 'OFFLINE';
    let label = 'Online';

    if (!online) {
      label = 'Offline';
    } else if (state.type === Network.NetworkStateType.WIFI) {
      connectionType = 'WIFI';
      label = 'Online (Wi-Fi)';
    } else if (state.type === Network.NetworkStateType.CELLULAR) {
      connectionType = 'CELLULAR';
      label = 'Online (Cellular)';
    }

    return {
      isConnected: online,
      connectionType,
      label,
    };
  } catch {
    return {
      isConnected: true,
      connectionType: 'UNKNOWN',
      label: 'Online',
    };
  }
}

export async function checkIsOnline(): Promise<boolean> {
  const status = await getNetworkStatusAsync();
  return status.isConnected;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    connectionType: 'UNKNOWN',
    label: 'Online',
  });

  useEffect(() => {
    let isMounted = true;

    async function checkNetwork() {
      const nextStatus = await getNetworkStatusAsync();
      if (isMounted) {
        setStatus(nextStatus);
      }
    }

    void checkNetwork();

    const interval = setInterval(() => {
      void checkNetwork();
    }, 3000);

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleOnline = () => {
        if (isMounted) {
          setStatus({
            isConnected: true,
            connectionType: 'ONLINE',
            label: 'Online',
          });
        }
      };
      const handleOffline = () => {
        if (isMounted) {
          setStatus({
            isConnected: false,
            connectionType: 'OFFLINE',
            label: 'Offline',
          });
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

  return status;
}
