defmodule IwsdkPhoenix.Protocol.Quantization do
  @moduledoc """
  "Smallest three" quaternion compression, 128 bits down to 32.

  This is an exact port of `quaternion-compression.ts` in the client package.
  The two implementations are covered by a shared golden-vector fixture, because
  a silent divergence here would not crash anything — it would just make every
  remote avatar subtly wrong, which is far harder to notice and to debug.

  A unit quaternion has three degrees of freedom, so the largest-magnitude
  component is always recoverable from the other three. We store that
  component's index in 2 bits and the remaining three in 10 bits each. Since `q`
  and `-q` are the same rotation, the quaternion is flipped so the dropped
  component is non-negative and its sign never has to be stored.

  ## Bit layout

      bits 31..30 | bits 29..20 | bits 19..10 | bits 9..0
      largest idx |     c0      |     c1      |    c2

  Each stored component maps `[-1/sqrt(2), +1/sqrt(2)]` onto `[1, 1023]` via
  `round(v / range * 511) + 512`. Sacrificing code `0` buys an exactly
  symmetric mapping in which zero lands on a code — so an identity quaternion
  round-trips with no error at all, which matters because identity is by far
  the most common rotation on the wire.
  """

  import Bitwise

  @range 0.7071067811865476
  @scale 511
  @offset 512

  @doc "Maximum magnitude a non-largest component of a unit quaternion can have."
  def range, do: @range

  @doc """
  Compress a quaternion into an unsigned 32-bit integer.

  The input need not be normalized. A zero-length quaternion degrades to
  identity rather than producing NaN.

  ## Examples

      iex> alias IwsdkPhoenix.Protocol.Quantization
      iex> packed = Quantization.compress_quaternion(%{x: 0.0, y: 0.0, z: 0.0, w: 1.0})
      iex> Quantization.decompress_quaternion(packed)
      %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}
  """
  @spec compress_quaternion(%{x: number(), y: number(), z: number(), w: number()}) ::
          non_neg_integer()
  def compress_quaternion(%{x: x, y: y, z: z, w: w}) do
    {nx, ny, nz, nw} = normalize(x / 1, y / 1, z / 1, w / 1)

    components = [nx, ny, nz, nw]
    largest_index = largest_index(components)
    largest_value = Enum.at(components, largest_index)
    sign = if largest_value < 0, do: -1.0, else: 1.0

    [c0, c1, c2] =
      components
      |> Enum.with_index()
      |> Enum.reject(fn {_value, index} -> index == largest_index end)
      |> Enum.map(fn {value, _index} -> quantize(value * sign) end)

    largest_index <<< 30 ||| c0 <<< 20 ||| c1 <<< 10 ||| c2
  end

  @doc """
  Decompress a value produced by `compress_quaternion/1`.

  Always returns a normalized quaternion, for every one of the 2^32 possible
  inputs — decoding is fed by untrusted network bytes.
  """
  @spec decompress_quaternion(non_neg_integer()) :: %{
          x: float(),
          y: float(),
          z: float(),
          w: float()
        }
  def decompress_quaternion(packed) when is_integer(packed) do
    value = packed &&& 0xFFFFFFFF

    largest_index = value >>> 30 &&& 0x3
    raw = [value >>> 20 &&& 0x3FF, value >>> 10 &&& 0x3FF, value &&& 0x3FF]

    restored = Enum.map(raw, &dequantize/1)

    {components, _} =
      Enum.map_reduce(0..3, restored, fn index, remaining ->
        if index == largest_index do
          {:placeholder, remaining}
        else
          [head | tail] = remaining
          {head, tail}
        end
      end)

    sum_of_squares =
      components
      |> Enum.reject(&(&1 == :placeholder))
      |> Enum.reduce(0.0, fn value, acc -> acc + value * value end)

    # Clamp before the square root: accumulated quantization error can push the
    # sum just past 1, and sqrt of a negative would yield NaN.
    largest = :math.sqrt(max(0.0, 1.0 - sum_of_squares))

    [x, y, z, w] =
      Enum.map(components, fn
        :placeholder -> largest
        value -> value
      end)

    {nx, ny, nz, nw} = normalize(x, y, z, w)
    %{x: nx, y: ny, z: nz, w: nw}
  end

  @doc "Angular difference between two quaternions, in radians."
  @spec angle_between(map(), map()) :: float()
  def angle_between(a, b) do
    dot = abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)
    2 * :math.acos(min(1.0, max(-1.0, dot)))
  end

  defp normalize(x, y, z, w) do
    length_squared = x * x + y * y + z * z + w * w

    if length_squared > 0 do
      inv = 1.0 / :math.sqrt(length_squared)
      {x * inv, y * inv, z * inv, w * inv}
    else
      {0.0, 0.0, 0.0, 1.0}
    end
  end

  defp largest_index(components) do
    components
    |> Enum.with_index()
    |> Enum.max_by(fn {value, _index} -> abs(value) end)
    |> elem(1)
  end

  defp quantize(value) do
    scaled = round(value / @range * @scale)
    clamped = scaled |> max(-@scale) |> min(@scale)
    clamped + @offset
  end

  defp dequantize(raw), do: (raw - @offset) / @scale * @range
end
