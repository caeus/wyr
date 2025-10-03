.PHONY: test build lint format docs release

build: lint test
	npx tsc -p tsconfig.build.json

test:
	# Vitest uses tsconfig.json unless explicitly pointed elsewhere.
	npx vitest run

lint:
	npx eslint 'src/**/*.ts'

format:
	npx prettier --write 'src/**/*.ts'

docs:
	npx typedoc

release: build docs
	@echo "All checks passed. Ready for release."
