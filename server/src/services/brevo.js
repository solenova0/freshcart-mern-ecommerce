export function createVerificationMailer(config, fetchRequest = fetch) {
  return async ({ email, name, token }) => {
    const verificationUrl = new URL(config.storefrontUrl ? '/verify-email' : '/api/auth/verify-email', config.storefrontUrl || config.apiPublicUrl)
    verificationUrl.searchParams.set('token', token)
    try {
      const response = await fetchRequest('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': config.brevoApiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: config.brevoSenderName, email: config.brevoSenderEmail },
          to: [{ email, name }],
          subject: 'Verify your FreshCart email',
          textContent: `Verify your FreshCart email by opening this link:\n\n${verificationUrl}\n\nThis link expires in ${config.verificationTtlMinutes} minutes. If you did not request this email, you can ignore it.`,
        }),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error('Brevo rejected the email request')
    } catch {
      const error = new Error('Verification email delivery is temporarily unavailable')
      error.status = 503
      throw error
    }
  }
}