const canonicalSchema = "https://soustack.dev/schema/recipe-vNext.json";
const profileLite = "soustack/recipe-lite";

type ValidationResult = {
  ok: boolean;
  errors: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const performValidation = (recipe: unknown): ValidationResult => {
  if (!isRecord(recipe)) {
    return { ok: false, errors: ["recipe must be an object."] };
  }

  const errors: string[] = [];

  if (typeof recipe.name !== "string" || !recipe.name.trim()) {
    errors.push("name is required.");
  }

  if (recipe.$schema !== canonicalSchema) {
    errors.push("$schema must match soustack vNext.");
  }

  if (recipe.profile !== profileLite) {
    errors.push("profile must be soustack/recipe-lite.");
  }

  if (!isRecord(recipe.stacks) || Object.keys(recipe.stacks).length === 0) {
    errors.push("stacks must contain at least one entry.");
  }

  return {
    ok: errors.length === 0,
    errors
  };
};

export const validateRecipe = (recipe: unknown): ValidationResult => performValidation(recipe);
export const validate = (recipe: unknown): ValidationResult => performValidation(recipe);
export const validateRecipePayload = (recipe: unknown): ValidationResult => performValidation(recipe);

export default {
  validateRecipe,
  validate,
  validateRecipePayload
};
