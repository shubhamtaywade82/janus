#!/usr/bin/env bash
# PostToolUse hook: run type-check + tests after every .ts/.tsx edit
# Outputs JSON systemMessage so result appears in Claude Code UI

PROJ=/home/nemesis/project/trading-workspace/janus

# Only run for .ts/.tsx/.js files inside this project
FILE=$(jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null)
echo "$FILE" | grep -qE "^$PROJ/.*\.(ts|tsx|js)$" || exit 0

cd "$PROJ" || exit 0

# Run type-check (capture output)
CHECK_OUT=$(npm run check 2>&1)
CHECK_EXIT=$?

# Run tests (capture output)
TEST_OUT=$(npm run test 2>&1)
TEST_EXIT=$?

# Filter out known pre-existing errors so only NEW ones surface
NEW_ERRS=$(echo "$CHECK_OUT" | grep "error TS" \
  | grep -v "dedup-paper-positions\|Signals\.tsx.*analyze\|trading-account\.ts.*TradingAccount\|AlertConfigPanel\|ChartOverlayPanel\|alert-engine\|Portfolio\.tsx.*isLoading\|Dashboard\.tsx.*label" \
  | head -10)

TEST_SUMMARY=$(echo "$TEST_OUT" | grep -E "Tests:|Test Files:|failed" | tail -3 | tr '\n' ' ')

# Build message
if [ $TEST_EXIT -ne 0 ]; then
  FAIL_TESTS=$(echo "$TEST_OUT" | grep -E "FAIL|× " | head -5 | tr '\n' ' ')
  MSG="❌ Tests failed: $FAIL_TESTS | $TEST_SUMMARY"
elif [ -n "$NEW_ERRS" ]; then
  MSG="❌ New type errors:
$NEW_ERRS
$TEST_SUMMARY"
else
  MSG="✅ $TEST_SUMMARY"
fi

# Emit JSON for Claude Code UI
python3 -c "import json,sys; print(json.dumps({'systemMessage': sys.argv[1]}))" "$MSG"
