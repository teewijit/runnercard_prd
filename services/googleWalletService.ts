import { ApiResponse } from '../types';
import { getConfig } from '../constants';

const UPDATE_GOOGLE_WALLET_FUNCTION_URL = '/functions/v1/update-google-wallet-pass';

export interface UpdateGoogleWalletPassResponse {
  success: boolean;
  message: string;
  objectId?: string;
}

/**
 * Updates Google Wallet pass for a specific runner
 * @param runnerId - The ID of the runner whose pass should be updated
 * @returns Promise with update result
 */
export const updateGoogleWalletPass = async (
  runnerId: string
): Promise<ApiResponse<UpdateGoogleWalletPassResponse>> => {
  if (!runnerId) {
    return { error: 'Runner ID is required.' };
  }

  const config = getConfig();
  const fullUrl = `${config.SUPABASE_URL}${UPDATE_GOOGLE_WALLET_FUNCTION_URL}`;

  try {
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ runnerId }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        error: errorData.error || `Failed to update Google Wallet pass. Status: ${response.status}`
      };
    }

    const data: UpdateGoogleWalletPassResponse = await response.json();
    return { data };
  } catch (error: any) {
    console.error('Error updating Google Wallet pass:', error);
    return {
      error: error.message || 'Failed to update Google Wallet pass.'
    };
  }
};

