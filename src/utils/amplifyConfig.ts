import { Amplify } from "aws-amplify";

let configurePromise: Promise<boolean> | null = null;

export function configureAmplify(): Promise<boolean> {
  if (configurePromise) {
    return configurePromise;
  }

  configurePromise = fetch(`${import.meta.env.BASE_URL}amplify_outputs.json`, {
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) {
        return false;
      }

      const outputs = await response.json();
      Amplify.configure(outputs);
      return true;
    })
    .catch(() => false);

  return configurePromise;
}
