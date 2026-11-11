import { useEffect, useState } from 'react';
import { createLocalDataServices, type LocalDataServices } from './local-data-service';

/** Opens the local data services for a component and closes them when it unmounts. */
export function useLocalServices(
  factory: typeof createLocalDataServices = createLocalDataServices,
): { services: LocalDataServices | null; error: string | null } {
  const [services, setServices] = useState<LocalDataServices | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let opened: LocalDataServices | null = null;
    factory()
      .then((result) => {
        if (!active) {
          result.close();
          return;
        }
        opened = result;
        setServices(result);
      })
      .catch((openError: unknown) => {
        if (active) {
          setError(
            openError instanceof Error ? openError.message : 'Local data could not be opened.',
          );
        }
      });
    return () => {
      active = false;
      opened?.close();
      setServices(null);
    };
  }, [factory]);

  return { services, error };
}
