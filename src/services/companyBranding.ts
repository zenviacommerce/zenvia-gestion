import { supabase, getActiveSupabase, getActiveTenant } from './supabase';
import { prepareCompanyStamp } from './companyStampImage';

const BUCKET = 'company-assets';
const MAX_LOGO_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export type CompanyBranding = {
  ownerId: string;
  logoPath?: string | null;
  logoDataUrl?: string | null;
  stampPath?: string | null;
  stampDataUrl?: string | null;
};

async function workspaceOwnerId(client = supabase) {
  const { data, error } = await client.from('business_settings').select('owner_id').maybeSingle();
  if (error) throw error;
  if (data?.owner_id) return data.owner_id as string;
  // Orders-only staff may not see fiscal settings. Branding SELECT RLS already
  // scopes this lookup to the canonical workspace owner, never the member UID.
  const {data:branding,error:brandingError}=await client.from('company_branding').select('owner_id').maybeSingle();
  if(brandingError)throw brandingError;
  if(branding?.owner_id)return branding.owner_id as string;
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!authData.user?.id) throw new Error('No se pudo identificar el espacio de trabajo.');
  const {data:member,error:memberError}=await client.from('app_users').select('data_owner_id').eq('user_id',authData.user.id).maybeSingle();
  if(memberError)throw memberError;
  if(!member?.data_owner_id)throw new Error('No se pudo identificar el espacio de trabajo.');
  return member.data_owner_id as string;
}

async function blobToPngDataUrl(blob: Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('No se pudo leer el logotipo.'));
      image.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo preparar el logotipo.');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function loadCompanyBranding(): Promise<CompanyBranding> {
  const client=getActiveSupabase(),workspace=getActiveTenant()?.workspace_id;
  const ownerId = await workspaceOwnerId(client);
  const { data, error } = await client.from('company_branding').select('logo_path,stamp_path').eq('owner_id', ownerId).maybeSingle();
  if (error) throw error;
  const logoPath = data?.logo_path || null, stampPath = data?.stamp_path || null;
  const readOptional = async (path: string | null) => {
    if (!path) return null;
    try {
      const {data:file,error:downloadError}=await client.storage.from(BUCKET).download(path);
      if(downloadError||!file)return null;
      return await blobToPngDataUrl(file);
    } catch { return null; }
  };
  const [logoDataUrl,stampDataUrl]=await Promise.all([readOptional(logoPath),readOptional(stampPath)]);
  if(client!==getActiveSupabase()||workspace!==getActiveTenant()?.workspace_id)throw new Error('La empresa o sesión ha cambiado.');
  return {ownerId,logoPath,logoDataUrl,stampPath,stampDataUrl};
}

export function validateCompanyLogo(file: File) {
  if (!ALLOWED_TYPES.includes(file.type)) throw new Error('El logotipo debe ser PNG, JPG o WebP.');
  if (file.size > MAX_LOGO_SIZE) throw new Error('El logotipo no puede superar 5 MB.');
}

export async function uploadCompanyLogo(file: File, currentPath?: string | null): Promise<CompanyBranding> {
  validateCompanyLogo(file);
  const ownerId = await workspaceOwnerId();
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png';
  const logoPath = `${ownerId}/branding/logo-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(logoPath, file, { cacheControl: '3600', upsert: false, contentType: file.type });
  if (uploadError) throw uploadError;

  const { error: saveError } = await supabase.from('company_branding').upsert({ owner_id: ownerId, logo_path: logoPath, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
  if (saveError) {
    await supabase.storage.from(BUCKET).remove([logoPath]);
    throw saveError;
  }

  if (currentPath && currentPath !== logoPath) await supabase.storage.from(BUCKET).remove([currentPath]);
  return loadCompanyBranding();
}

export async function removeCompanyLogo(currentPath?: string | null): Promise<CompanyBranding> {
  const ownerId = await workspaceOwnerId();
  const { error } = await supabase.from('company_branding').upsert({ owner_id: ownerId, logo_path: null, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
  if (error) throw error;
  if (currentPath) await supabase.storage.from(BUCKET).remove([currentPath]);
  return loadCompanyBranding();
}


export function validateCompanyStamp(file: File) {
  if (!['image/png','image/jpeg'].includes(file.type)) throw new Error('El sello debe ser PNG o JPG.');
  if (file.size > MAX_LOGO_SIZE) throw new Error('El sello no puede superar 5 MB.');
}

export async function uploadCompanyStamp(file:File,currentPath?:string|null):Promise<CompanyBranding>{
  validateCompanyStamp(file);
  const client=getActiveSupabase(),workspace=getActiveTenant()?.workspace_id;
  const ownerId=await workspaceOwnerId(client);
  const processed=await prepareCompanyStamp(file);
  if(client!==getActiveSupabase()||workspace!==getActiveTenant()?.workspace_id)throw new Error('La empresa o sesión ha cambiado.');
  const stampPath=`${ownerId}/branding/stamp-${crypto.randomUUID()}.png`;
  const {error:uploadError}=await client.storage.from(BUCKET).upload(stampPath,processed,{contentType:'image/png',upsert:false});
  if(uploadError)throw uploadError;
  const {error:saveError}=await client.from('company_branding').upsert({owner_id:ownerId,stamp_path:stampPath,updated_at:new Date().toISOString()},{onConflict:'owner_id'});
  if(saveError){await client.storage.from(BUCKET).remove([stampPath]);throw saveError}
  if(currentPath&&currentPath!==stampPath)await client.storage.from(BUCKET).remove([currentPath]);
  if(client!==getActiveSupabase()||workspace!==getActiveTenant()?.workspace_id)throw new Error('La empresa o sesión ha cambiado.');
  return loadCompanyBranding();
}

export async function removeCompanyStamp(currentPath?:string|null):Promise<CompanyBranding>{
  const client=getActiveSupabase(),workspace=getActiveTenant()?.workspace_id;
  const ownerId=await workspaceOwnerId(client);
  if(client!==getActiveSupabase()||workspace!==getActiveTenant()?.workspace_id)throw new Error('La empresa o sesión ha cambiado.');
  const {error}=await client.from('company_branding').upsert({owner_id:ownerId,stamp_path:null,updated_at:new Date().toISOString()},{onConflict:'owner_id'});
  if(error)throw error;
  if(currentPath)await client.storage.from(BUCKET).remove([currentPath]);
  if(client!==getActiveSupabase()||workspace!==getActiveTenant()?.workspace_id)throw new Error('La empresa o sesión ha cambiado.');
  return loadCompanyBranding();
}
