import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const getOAuthUrl = () => {
  const authUrl = import.meta.env.VITE_AUTH_URL || window.location.origin;
  const appID = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  // Dev mock: AUTH_URL points to localhost but no OAuth server runs there.
  // Go straight to the callback — the backend will accept "mock-code" and bypass JWKS.
  const isMockMode = authUrl.includes("localhost") || authUrl.includes("127.0.0.1");
  if (isMockMode) {
    const cbUrl = new URL(redirectUri);
    cbUrl.searchParams.set("code", "mock-code");
    cbUrl.searchParams.set("state", state);
    return cbUrl.toString();
  }

  const url = new URL(`${authUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);

  return url.toString();
}

const Login = () => {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            size="lg"
            onClick={() => {
              window.location.href = getOAuthUrl();
            }}
          >
            Sign in
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
