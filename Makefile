.PHONY: test compile build lint format docs publish

compile: lint test
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

build: compile docs
	@echo "All checks passed. Ready to publish."

publish: build
	npm publish
