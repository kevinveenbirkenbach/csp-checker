# Makefile
IMAGE ?= csp-checker:latest

.PHONY: install build run clean test test-e2e lint lint-shell lint-node lint-docker

## Run every check CI runs: the three linters, then the E2E suite
test: lint test-e2e

## Run the three linters CI runs, in the order that fails cheapest first
lint: lint-shell lint-node lint-docker

lint-shell:
	git ls-files '*.sh' | xargs --no-run-if-empty shellcheck

lint-node:
	git ls-files '*.js' | xargs --no-run-if-empty -n1 node --check

lint-docker:
	docker run --rm -i hadolint/hadolint hadolint --ignore DL3018 - < Dockerfile

test-e2e:
	./tests/e2e/run.sh

## Build with cache-bust and pull latest base
build:
	docker build --pull \
		--build-arg BUILD_TS=$(shell date +%s) \
		-t $(IMAGE) .

## Run the checker; pass domain args via ARGS="example.org api.example.org"
run:
	docker run --rm $(IMAGE) $(ARGS)

## Remove the built image (best-effort)
clean:
	- docker rmi $(IMAGE) 2>/dev/null || true
