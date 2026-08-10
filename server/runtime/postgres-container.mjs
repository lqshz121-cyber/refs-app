const LEGACY_DATA_VOLUME_TARGET='/var/lib/postgresql/data';
const VERSIONED_DATA_VOLUME_TARGET='/var/lib/postgresql';

export function postgresDataVolumeTarget(image){
  const match=/^postgres:(\d+)(?:[.-]|$)/.exec(String(image||'').trim());
  return match&&Number(match[1])>=18?VERSIONED_DATA_VOLUME_TARGET:LEGACY_DATA_VOLUME_TARGET;
}
